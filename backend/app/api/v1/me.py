"""My own account, for every role (the administrator manages its own account only here). The same operations as
/auth/me and /auth/change-password, which stay for existing clients."""
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.v1.auth import _me, _set_session_cookie
from app.core.deps import client_ip, get_current_user_even_if_locked, get_db
from app.models.user import User
from app.schemas.auth import ChangePasswordRequest, ProfileUpdate
from app.schemas.user import MeOut, MyNameUpdate
from app.services import auth_service

router = APIRouter(prefix="/me", tags=["my account"])


@router.get("", response_model=MeOut)
def get_me(user: User = Depends(get_current_user_even_if_locked)) -> MeOut:
    return _me(user)


@router.patch("", response_model=MeOut)
def update_me(body: MyNameUpdate, request: Request, user: User = Depends(get_current_user_even_if_locked),
              db: Session = Depends(get_db)) -> MeOut:
    """Change my own full name."""
    return _me(auth_service.update_profile(db, user, ProfileUpdate(full_name=body.full_name), client_ip(request)))


@router.post("/change-password", status_code=204)
def change_my_password(body: ChangePasswordRequest, request: Request, response: Response,
                       user: User = Depends(get_current_user_even_if_locked), db: Session = Depends(get_db)) -> None:
    """Change my own password (current + new). Other devices are signed out; this one gets a fresh session cookie.
    Allowed while a temporary password still has to be changed."""
    token = auth_service.change_password(db, user, body.current_password, body.new_password, client_ip(request))
    _set_session_cookie(response, token)
