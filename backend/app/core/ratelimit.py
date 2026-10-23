import redis


def acquire_slot(r: "redis.Redis", key: str, seconds: int) -> bool:
    """Atomic per-key cooldown: True if the caller got the slot, False if the key is still cooling down.

    One Redis command (SET key NX EX seconds), so two simultaneous requests can't both win.
    """
    return bool(r.set(key, "1", nx=True, ex=seconds))
