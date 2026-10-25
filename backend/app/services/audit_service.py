from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog

# Action names written to activity_logs.action
LOGIN = "login"
LOGIN_FAILED = "login_failed"
LOGOUT = "logout"
USER_CREATE = "user_create"
USER_UPDATE = "user_update"
USER_IMPORT = "user_import"
PASSWORD_RESET = "password_reset"
ADMIN_PASSWORD_RESET = "admin_password_reset"
PASSWORD_CHANGE = "password_change"
PASSWORD_CHANGE_FAILED = "password_change_failed"
PROFILE_UPDATE = "profile_update"
CLASS_CREATE = "class_create"
INVITE_CODE_CREATE = "invite_code_create"
INVITE_CODE_UPDATE = "invite_code_update"
ENROLL_REQUEST = "enroll_request"
ENROLLMENT_APPROVE = "enrollment_approve"
ENROLLMENT_REJECT = "enrollment_reject"
ENROLLMENT_REMOVE = "enrollment_remove"
SESSION_CREATE = "session_create"
SESSION_OPEN = "session_open"
SESSION_CLOSE = "session_close"
SESSION_UPDATE = "session_update"
ACTIVITY_CREATE = "activity_create"
ACTIVITY_UPDATE = "activity_update"
ACTIVITY_PUBLISH = "activity_publish"
ACTIVITY_DELETE = "activity_delete"
ACTIVITY_ARCHIVE = "activity_archive"
SUBMIT = "submit"
RUN = "run"
TEST_CASE_CHANGE = "test_case_change"
REGRADE = "regrade"
LAB_CHANGE = "lab_change"
SEAT_PLAN = "seat_plan"
SEAT_RELEASE = "seat_release"
SESSION_SEATING = "session_seating"
TUTORIAL_CHANGE = "tutorial_change"
REGISTRATION_CODES_GENERATE = "registration_codes_generate"
REGISTRATION_CODE_REVOKE = "registration_code_revoke"
REGISTER = "register"
REGISTER_FAILED = "register_failed"
STORAGE_LIMITS_UPDATE = "storage_limits_update"
USER_STORAGE_UPDATE = "user_storage_update"
WORKSPACE_CLEAR = "workspace_clear"


def record(
    db: Session,
    action: str,
    user_id: Optional[int] = None,
    details: Optional[dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> None:
    """Adds an audit row to the caller's transaction (the caller commits).

    Never put passwords, tokens or student code in `details`.
    """
    db.add(ActivityLog(user_id=user_id, action=action, details=details, ip_address=ip_address))
