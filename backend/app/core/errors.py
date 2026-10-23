from typing import Any, Optional


class AppError(Exception):
    """Business-rule error. Rendered as {"detail": "...", "code": "SNAKE_CASE_CODE"} plus any `extra` fields
    (e.g. the conflicting booking of LAB_BOOKED)."""

    def __init__(self, status_code: int, detail: str, code: str, extra: Optional[dict[str, Any]] = None) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code
        self.extra = extra or {}


class NotFoundError(AppError):
    def __init__(self, detail: str = "Not found", code: str = "NOT_FOUND") -> None:
        super().__init__(404, detail, code)


class ForbiddenError(AppError):
    def __init__(self, detail: str = "Forbidden", code: str = "FORBIDDEN") -> None:
        super().__init__(403, detail, code)


class UnauthorizedError(AppError):
    def __init__(self, detail: str = "Not authenticated", code: str = "UNAUTHORIZED") -> None:
        super().__init__(401, detail, code)


class ConflictError(AppError):
    def __init__(self, detail: str = "Conflict", code: str = "CONFLICT", **extra: Any) -> None:
        super().__init__(409, detail, code, extra)
