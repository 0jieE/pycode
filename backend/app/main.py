import logging
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1 import (activities, auth, classes, enrollments, health, labs, monitor, practice, registration_codes,
                        run, sessions, storage, test_cases, tutorial, users, workspace, ws)
from app.core.config import settings
from app.core.errors import AppError
from app.core.logging import configure_logging

configure_logging(settings.LOG_LEVEL, access_log=settings.ENV != "prod" or settings.ACCESS_LOG)
logger = logging.getLogger(__name__)

API_PREFIX = "/api/v1"

app = FastAPI(
    title="Lab Management System API",
    docs_url=f"{API_PREFIX}/docs",
    openapi_url=f"{API_PREFIX}/openapi.json",
    redoc_url=None,
)

app.include_router(health.router, prefix=API_PREFIX)
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(users.router, prefix=API_PREFIX)
app.include_router(storage.router, prefix=API_PREFIX)
app.include_router(registration_codes.router, prefix=API_PREFIX)
app.include_router(classes.router, prefix=API_PREFIX)
app.include_router(enrollments.router, prefix=API_PREFIX)
app.include_router(sessions.router, prefix=API_PREFIX)
app.include_router(activities.router, prefix=API_PREFIX)
app.include_router(workspace.router, prefix=API_PREFIX)
app.include_router(run.router, prefix=API_PREFIX)
app.include_router(practice.router, prefix=API_PREFIX)
app.include_router(test_cases.router, prefix=API_PREFIX)
app.include_router(monitor.router, prefix=API_PREFIX)
app.include_router(labs.router, prefix=API_PREFIX)
app.include_router(tutorial.router, prefix=API_PREFIX)
app.include_router(tutorial.matrix_router, prefix=API_PREFIX)
app.include_router(ws.router, prefix=API_PREFIX)


def _error(status_code: int, detail: str, code: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": detail, "code": code, **extra})


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return _error(exc.status_code, exc.detail, exc.code, **exc.extra)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = HTTPStatus(exc.status_code).name  # e.g. NOT_FOUND, METHOD_NOT_ALLOWED
    return _error(exc.status_code, str(exc.detail), code)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    detail = "; ".join(
        f"{'.'.join(str(p) for p in e['loc'] if p != 'body')}: {e['msg']}" for e in exc.errors()
    )
    return _error(422, detail or "Invalid request", "VALIDATION_ERROR")


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error", extra={"path": request.url.path, "method": request.method})
    return _error(500, "Internal server error", "INTERNAL_ERROR")
