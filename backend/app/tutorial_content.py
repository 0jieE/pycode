"""The tutorial's default lessons: content/tutorial/NN-slug.md, each a YAML front matter (title, order, summary,
examples, exercise) followed by the lesson text in Markdown.

    python -m app.tutorial_content            # load / update every lesson into the database (idempotent, by slug)

The same loader serves "Reset to default" for one lesson. Loading OVERWRITES the lesson's content in the database
with the file's (title, summary, body, examples, exercise, order); is_hidden is kept, so hiding a lesson survives
a re-seed."""
import re
import sys
from pathlib import Path
from typing import Any, Optional

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.tutorial import TutorialLesson
from app.schemas.tutorial import ExampleSpec, ExerciseSpec, SeedResult, _slug

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content" / "tutorial"
FILE_RE = re.compile(r"^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$")


class LessonFile(BaseModel):
    """The front matter, validated like a lesson edited through the API."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=150)
    order: int = Field(ge=0)
    summary: str = Field(default="", max_length=300)
    examples: list[ExampleSpec] = Field(default_factory=list, max_length=10)
    exercise: ExerciseSpec


class ParsedLesson(BaseModel):
    slug: str
    front: LessonFile
    body_md: str


class ContentError(ValueError):
    pass


def lesson_files() -> dict[str, Path]:
    """slug -> file, for every lesson file in the content folder."""
    files: dict[str, Path] = {}
    if not CONTENT_DIR.is_dir():
        return files
    for path in sorted(CONTENT_DIR.glob("*.md")):
        match = FILE_RE.match(path.name)
        if match:
            files[match.group(2)] = path
    return files


def parse_lesson(path: Path) -> ParsedLesson:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ContentError(f"{path.name}: must start with a YAML front matter ('---')")
    end = text.find("\n---\n", 4)
    if end < 0:
        raise ContentError(f"{path.name}: the front matter is not closed ('---')")
    try:
        raw: Any = yaml.safe_load(text[4:end])
    except yaml.YAMLError as exc:
        raise ContentError(f"{path.name}: bad YAML: {exc}")
    if not isinstance(raw, dict):
        raise ContentError(f"{path.name}: the front matter must be a mapping")
    try:
        front = LessonFile.model_validate(raw)
    except ValidationError as exc:
        raise ContentError(f"{path.name}: {exc.errors()[0]['loc']}: {exc.errors()[0]['msg']}")
    body = text[end + 5:].strip("\n")
    if not body.strip():
        raise ContentError(f"{path.name}: the lesson text (after the front matter) is empty")
    match = FILE_RE.match(path.name)
    return ParsedLesson(slug=_slug(match.group(2)), front=front, body_md=body)


def apply(db: Session, parsed: ParsedLesson) -> bool:
    """Writes the file's content to the lesson row (created if needed). Returns True when the row was created."""
    lesson = db.scalar(select(TutorialLesson).where(TutorialLesson.slug == parsed.slug))
    created = lesson is None
    if created:
        lesson = TutorialLesson(slug=parsed.slug, is_hidden=False)
        db.add(lesson)
    front = parsed.front
    lesson.title, lesson.sort_order, lesson.summary, lesson.body_md = front.title, front.order, front.summary, parsed.body_md
    lesson.examples = [e.model_dump() for e in front.examples]
    lesson.exercise = front.exercise.model_dump()
    return created


def load_all(db: Session) -> SeedResult:
    """Loads every lesson file. Fails as a whole (nothing written) if any file is invalid."""
    parsed = [parse_lesson(path) for path in lesson_files().values()]
    result = SeedResult(created=[], updated=[])
    for lesson in parsed:
        (result.created if apply(db, lesson) else result.updated).append(lesson.slug)
    db.commit()
    return result


def load_one(db: Session, slug: str) -> Optional[TutorialLesson]:
    """Reset to default: the lesson as its repo file says, or None if there is no file for this slug."""
    path = lesson_files().get(slug)
    if path is None:
        return None
    apply(db, parse_lesson(path))
    db.commit()
    return db.scalar(select(TutorialLesson).where(TutorialLesson.slug == slug))


def main() -> int:
    from app.core.database import SessionLocal

    with SessionLocal() as db:
        try:
            result = load_all(db)
        except ContentError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
    print(f"tutorial: {len(result.created)} lessons created, {len(result.updated)} updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
