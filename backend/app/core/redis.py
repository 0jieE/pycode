import json
import logging
from functools import lru_cache
from typing import Any

import redis

from app.core.config import settings

logger = logging.getLogger(__name__)


@lru_cache
def get_redis() -> "redis.Redis":
    """Shared sync Redis client (connection pool is thread-safe)."""
    return redis.Redis.from_url(settings.REDIS_URL, decode_responses=True, socket_timeout=2)


def publish_event(channel: str, payload: dict[str, Any]) -> None:
    """Fire-and-forget pub/sub message. Call AFTER the database commit, so a receiver that reacts
    to the event by reading the API sees the new state. A Redis outage never fails the request."""
    try:
        get_redis().publish(channel, json.dumps(payload))
    except redis.RedisError:
        logger.exception("could not publish event", extra={"channel": channel, "event": payload.get("type")})
