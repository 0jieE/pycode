from collections.abc import Callable, Iterator
from dataclasses import dataclass
import ipaddress
from typing import Optional

from fastapi import Depends, Query, Request
from starlette.requests import HTTPConnection
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.redis import get_redis  # noqa: F401  (re-exported for routers)
from app.models.user import Role, User
from app.services import auth_service


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _trusted_proxies() -> frozenset[str]:
    return frozenset(p.strip() for p in settings.TRUSTED_PROXY_IPS.split(",") if p.strip())


def _valid_ip(value: Optional[str]) -> Optional[str]:
    try:
        return str(ipaddress.ip_address((value or "").strip()))
    except ValueError:
        return None


def get_client_ip(conn: HTTPConnection) -> Optional[str]:
    """The real client address, for a Request or a WebSocket.

    The proxy headers are believed ONLY when the TCP peer is Nginx (TRUSTED_PROXY_IPS). Nginx overwrites them with
    $remote_addr, so a client cannot inject its own. From anyone else, X-Real-IP / X-Forwarded-For are ignored and the
    peer address is the answer. (In production uvicorn/gunicorn already apply the same rule with
    forwarded_allow_ips, so the peer is usually the client by the time it gets here.)"""
    peer = conn.client.host if conn.client else None
    if peer in _trusted_proxies():
        forwarded = conn.headers.get("x-real-ip") or conn.headers.get("x-forwarded-for", "").split(",")[-1]
        real = _valid_ip(forwarded)
        if real:
            return real
    return _valid_ip(peer) or peer


def client_ip(request: Request) -> Optional[str]:
    return get_client_ip(request)


def get_current_user_even_if_locked(request: Request, db: Session = Depends(get_db)) -> User:
    """The signed-in user, also while they still have to change a temporary password. Only for /auth/me,
    /auth/change-password and /auth/logout."""
    token = request.cookies.get(settings.COOKIE_NAME)
    if not token:
        raise UnauthorizedError("Not authenticated", "NOT_AUTHENTICATED")
    return auth_service.authenticate_token(db, token, allow_password_change_pending=True)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """The signed-in user. 403 PASSWORD_CHANGE_REQUIRED while a temporary password has not been changed yet."""
    token = request.cookies.get(settings.COOKIE_NAME)
    if not token:
        raise UnauthorizedError("Not authenticated", "NOT_AUTHENTICATED")
    return auth_service.authenticate_token(db, token)


def require_role(*roles: Role) -> Callable[..., User]:
    """Dependency factory: the route is only reachable by users with one of `roles`."""

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise ForbiddenError("You do not have permission to do this", "FORBIDDEN_ROLE")
        return user

    return checker


@dataclass
class PageParams:
    page: int
    size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


def pagination(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100)) -> PageParams:
    return PageParams(page=page, size=size)
