from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str  # "ok" | "degraded"
    checks: dict[str, str]  # database / redis / docker -> "ok" | "down" | "unknown"
