"""Recovery of the administrator account, on the server:

    docker compose exec api python -m app.reset_admin

Prints a NEW temporary password for the one administrator, which must be changed at the next sign-in. The account is
also re-enabled and signed out everywhere. Recorded in the audit log ("admin_password_reset", no user: it was done on
the server). Only someone who can run commands on the server can do this.
"""
import sys

from app.core.database import SessionLocal
from app.core.security import generate_temp_password, hash_password
from app.services import audit_service, user_service


def reset_admin() -> tuple[str, str]:
    """(username, temporary password). Raises LookupError when there is no administrator yet."""
    with SessionLocal() as db:
        admin = user_service.get_admin(db)
        if admin is None:
            raise LookupError("There is no administrator account yet. Run the first setup: python -m app.seed")
        password = generate_temp_password()
        admin.password_hash = hash_password(password)
        admin.must_change_password = True
        admin.is_active = True
        admin.current_session_id = None
        audit_service.record(db, audit_service.ADMIN_PASSWORD_RESET, user_id=None,
                             details={"target_id": admin.id, "via": "app.reset_admin"})
        db.commit()
        return admin.username, password


def main() -> int:
    try:
        username, password = reset_admin()
    except LookupError as e:
        print(str(e), file=sys.stderr)
        return 1
    print(f"\nThe administrator password was reset.\n\n  username:            {username}\n"
          f"  temporary password:  {password}\n\nSign in with it: you will be asked to choose a new password.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
