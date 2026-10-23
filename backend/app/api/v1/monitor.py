from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_role
from app.models.user import Role, User
from app.schemas.monitor import MonitorSnapshot
from app.services import monitor_service

router = APIRouter(tags=["monitor"])


@router.get("/sessions/{session_id}/monitor", response_model=MonitorSnapshot)
def monitor_snapshot(session_id: int, user: User = Depends(require_role(Role.INSTRUCTOR)),
                     db: Session = Depends(get_db)) -> MonitorSnapshot:
    """Where every approved student stands right now. Live changes arrive on WS /ws/monitor/{session_id}."""
    return monitor_service.snapshot(db, user, session_id)
