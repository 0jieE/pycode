"""Computer labs: named rooms that lab sessions book (booking_service). Labs are shared rooms: any instructor or admin
may manage them."""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError
from app.models.lab import Lab
from app.models.user import User
from app.schemas.lab import LabCreate, LabOut, LabUpdate
from app.services import audit_service, booking_service


def _lab(db: Session, lab_id: int) -> Lab:
    lab = db.get(Lab, lab_id)
    if lab is None:
        raise NotFoundError("Lab not found", "LAB_NOT_FOUND")
    return lab


def _audit(db: Session, user: User, op: str, ip: Optional[str], **details) -> None:
    audit_service.record(db, audit_service.LAB_CHANGE, user_id=user.id, details={"op": op, **details}, ip_address=ip)


def _name_taken() -> ConflictError:
    return ConflictError("A lab with this name already exists", "LAB_NAME_TAKEN")


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:          # the same name saved by someone else at the same moment
        db.rollback()
        raise _name_taken()


def list_labs(db: Session) -> list[LabOut]:
    return [LabOut.model_validate(lab) for lab in db.scalars(select(Lab).order_by(Lab.name))]


def get_lab(db: Session, lab_id: int) -> LabOut:
    return LabOut.model_validate(_lab(db, lab_id))


def create_lab(db: Session, user: User, data: LabCreate, ip: Optional[str]) -> LabOut:
    if db.scalar(select(Lab.id).where(Lab.name == data.name)) is not None:
        raise _name_taken()
    lab = Lab(name=data.name)
    db.add(lab)
    db.flush()
    _audit(db, user, "create", ip, lab_id=lab.id)
    _commit(db)
    return LabOut.model_validate(lab)


def update_lab(db: Session, user: User, lab_id: int, data: LabUpdate, ip: Optional[str]) -> LabOut:
    lab = _lab(db, lab_id)
    if db.scalar(select(Lab.id).where(Lab.name == data.name, Lab.id != lab.id)) is not None:
        raise _name_taken()
    lab.name = data.name
    _audit(db, user, "update", ip, lab_id=lab.id, fields=["name"])
    _commit(db)
    return LabOut.model_validate(lab)


def delete_lab(db: Session, user: User, lab_id: int, ip: Optional[str]) -> None:
    """Refused while sessions that have not ended book it (no class without a room); ended sessions keep their
    history, without a room."""
    lab = booking_service.lock_lab(db, lab_id)
    booked = booking_service.count_booked(db, lab.id)
    if booked:
        name = lab.name
        db.rollback()
        raise ConflictError(f"{name} still has {booked} session{'s' if booked != 1 else ''} that "
                            f"{'have' if booked != 1 else 'has'} not ended. Move them to another lab first.",
                            "LAB_HAS_SESSIONS", sessions=booked)
    db.delete(lab)
    _audit(db, user, "delete", ip, lab_id=lab_id)
    db.commit()
