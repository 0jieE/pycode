from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import client_ip, get_current_user_even_if_locked, get_db
from app.models.user import User
from app.schemas.auth import ChangePasswordRequest, LoginRequest, ProfileUpdate
from app.schemas.registration import RegisterRequest
from app.schemas.preferences import Preferences, PreferencesUpdate
from app.schemas.user import MeOut, UserOut
from app.services import auth_service, preferences_service, registration_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _me(user: User) -> MeOut:
    return MeOut(**UserOut.model_validate(user).model_dump(), preferences=preferences_service.preferences_of(user))


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.COOKIE_NAME,
        token,
        max_age=settings.JWT_EXPIRE_MINUTES * 60,
        httponly=True,
        samesite="lax",
        secure=settings.COOKIE_SECURE,
        path="/",
    )


@router.post("/login", response_model=MeOut)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> MeOut:
    user, token = auth_service.login(db, body.username, body.password, client_ip(request),
                                     request.headers.get("user-agent"))
    _set_session_cookie(response, token)
    return _me(user)


@router.post("/register", response_model=MeOut, status_code=201)
def register(body: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> MeOut:
    """Public student sign-up with a one-time registration code from an admin. Signs the new student in."""
    user, token = registration_service.register(db, body, client_ip(request))
    _set_session_cookie(response, token)
    return _me(user)


@router.post("/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    user: User = Depends(get_current_user_even_if_locked),
    db: Session = Depends(get_db),
) -> None:
    auth_service.logout(db, user, client_ip(request))
    response.delete_cookie(settings.COOKIE_NAME, path="/")


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user_even_if_locked)) -> MeOut:
    return _me(user)


@router.patch("/me", response_model=MeOut)
def update_me(body: ProfileUpdate, request: Request, user: User = Depends(get_current_user_even_if_locked),
              db: Session = Depends(get_db)) -> MeOut:
    """Change my own full_name and/or username (role, student_no and is_active are not editable)."""
    return _me(auth_service.update_profile(db, user, body, client_ip(request)))


@router.patch("/me/preferences", response_model=Preferences)
def update_my_preferences(body: PreferencesUpdate, user: User = Depends(get_current_user_even_if_locked),
                          db: Session = Depends(get_db)) -> Preferences:
    """Change my own preferences. Send only what changes (e.g. {"theme": "light"}); the full object comes back.
    Allowed while a temporary password still has to be changed."""
    return preferences_service.update_preferences(db, user, body)


@router.post("/change-password", status_code=204)
def change_password(body: ChangePasswordRequest, request: Request, response: Response,
                    user: User = Depends(get_current_user_even_if_locked), db: Session = Depends(get_db)) -> None:
    """Change my own password. Other devices are signed out; this one gets a fresh session cookie."""
    token = auth_service.change_password(db, user, body.current_password, body.new_password, client_ip(request))
    _set_session_cookie(response, token)
