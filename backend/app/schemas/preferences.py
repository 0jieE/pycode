"""Per-user preferences (the Settings menu). Stored on users.preferences as JSON; every field has a default, so a user
who never chose anything, or a row written before a field existed, still gets a complete object.

To add a setting later: add a field with a default to Preferences and to PreferencesUpdate. Nothing else changes, and
older clients keep working (they ignore the new field and never send it)."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Theme = Literal["dark", "light", "system"]
EditorTheme = Literal["dark", "light", "match"]


class Preferences(BaseModel):
    """Always complete: missing values are filled with the defaults. Never null."""

    theme: Theme = "dark"                # the whole app; "system" follows the computer's light/dark setting
    editor_theme: EditorTheme = "match"  # the code editor; "match" = same as theme


class PreferencesUpdate(BaseModel):
    """Send only what changes, e.g. {"theme": "light"}. Unknown fields, unknown values and null are a 422."""

    model_config = ConfigDict(extra="forbid")

    # The type has no None, so an explicit null is rejected; the default only means "not sent".
    theme: Theme = Field(default=None)
    editor_theme: EditorTheme = Field(default=None)
