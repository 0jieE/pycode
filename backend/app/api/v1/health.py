import redis
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_redis
from app.schemas.health import HealthResponse
from app.services import health_service

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(
    response: Response,
    db: Session = Depends(get_db),
    r: redis.Redis = Depends(get_redis),
) -> HealthResponse:
    healthy, checks = health_service.get_health(db, r)
    if not healthy:
        response.status_code = 503
    return HealthResponse(status="ok" if healthy else "degraded", checks=checks)
