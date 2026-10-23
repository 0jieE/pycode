"""The signed-in user's own preferences. Only ever read or written for oneself: there is no admin access."""
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models.user import User
from app.schemas.preferences import Preferences, PreferencesUpdate


def preferences_of(user: User) -> Preferences:
    """The stored choices merged over the defaults. A stored value that is no longer valid (or a field that no longer
    exists) falls back to the default instead of breaking the user's sign-in."""
    stored: dict[str, Any] = user.preferences if isinstance(user.preferences, dict) else {}
    values: dict[str, Any] = {}
    for name in Preferences.model_fields:
        if name in stored:
            try:
                Preferences.model_validate({name: stored[name]})
            except ValidationError:
                continue
            values[name] = stored[name]
    return Preferences(**values)


def update_preferences(db: Session, user: User, data: PreferencesUpdate) -> Preferences:
    changes = data.model_dump(exclude_unset=True)
    merged = {**preferences_of(user).model_dump(), **changes}
    user.preferences = merged  # a new dict, so SQLAlchemy sees the JSON column change
    db.commit()
    return Preferences(**merged)
