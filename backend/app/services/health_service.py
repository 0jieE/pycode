import logging

import redis
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# The api container has no Docker socket (only the worker does). The worker's beat task
# refreshes this key ("ok"/"down") every 15 s with a 45 s TTL; the api only reads it.
DOCKER_HEALTH_KEY = "health:docker"


def check_database(db: Session) -> str:
    try:
        db.execute(text("SELECT 1"))
        return "ok"
    except Exception:
        logger.exception("health: database check failed")
        return "down"


def check_redis(r: "redis.Redis") -> str:
    try:
        return "ok" if r.ping() else "down"
    except Exception:
        logger.exception("health: redis check failed")
        return "down"


def check_docker(r: "redis.Redis") -> str:
    """ok / down as reported by the worker's heartbeat; unknown when there is no recent heartbeat."""
    try:
        state = r.get(DOCKER_HEALTH_KEY)
    except Exception:
        return "unknown"
    return state if state in ("ok", "down") else "unknown"


def get_health(db: Session, r: "redis.Redis") -> tuple[bool, dict[str, str]]:
    """Returns (healthy, checks). Docker 'unknown' (no worker heartbeat yet) does not fail health."""
    checks = {
        "database": check_database(db),
        "redis": check_redis(r),
    }
    checks["docker"] = check_docker(r) if checks["redis"] == "ok" else "unknown"
    healthy = checks["database"] == "ok" and checks["redis"] == "ok" and checks["docker"] != "down"
    return healthy, checks
