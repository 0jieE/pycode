"""WebSockets. Authenticated with the same JWT cookie as the REST API; messages come from Redis pub/sub, so
any of the api processes can serve any client.

Close codes: 4401 not signed in / session replaced, 4403 not allowed, 4404 not found, 4408 idle.
Before closing for an error the server sends {"type": "error", "code": "...", "detail": "..."}.
Database work is synchronous, so it runs in the threadpool and never blocks the event loop.
"""
import asyncio
import contextlib
import json
import logging
from typing import Any, Awaitable, Callable, Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.errors import AppError, ForbiddenError, NotFoundError, UnauthorizedError
from app.models.execution import Execution, ExecutionStatus
from app.models.lab_session import LabSession
from app.models.user import Role, User
from app.services import (auth_service, class_service, grading_service, interactive_service, monitor_service,
                          session_service)

logger = logging.getLogger(__name__)
router = APIRouter()

REVALIDATE_SECONDS = 20.0   # how often an open socket re-checks that its user may still be here
STUDENT_IDLE_SECONDS = 60.0  # a student's class socket must send a heartbeat at least this often
RUN_POLL_SECONDS = 3.0      # safety net: look at the database in case an event was missed
RUN_STREAM_MAX_SECONDS = 90.0
FINISHED = {s for s in ExecutionStatus if s not in (ExecutionStatus.QUEUED, ExecutionStatus.RUNNING)}


# ------------------------------------------------------------- sync checks (threadpool)

def _user(db, token: Optional[str]) -> User:
    if not token:
        raise UnauthorizedError("Not authenticated", "NOT_AUTHENTICATED")
    return auth_service.authenticate_token(db, token)


def _execution_state(ex: Execution) -> dict[str, Any]:
    return {"status": ex.status.value, "finished": ex.status in FINISHED, "exit_code": ex.exit_code,
            "duration_ms": ex.duration_ms, "output": ex.output or "", "kind": ex.kind.value,
            "mode": ex.mode.value, "results": ex.test_results}


def _done_event(state: dict[str, Any]) -> dict[str, Any]:
    """The final message. For a test / grade job it also carries the totals."""
    event: dict[str, Any] = {"type": "done", "status": state["status"], "exit_code": state["exit_code"],
                             "duration_ms": state["duration_ms"]}
    if state["kind"] != "run":
        results = state["results"] or []
        event.update(kind=state["kind"], passed=sum(1 for r in results if r.get("passed")), total=len(results),
                     score=sum(r.get("points_awarded", 0) for r in results),
                     max_score=sum(r.get("points", 0) for r in results))
    return event


async def _send_final(ws: WebSocket, state: dict[str, Any], full_output: bool) -> None:
    """Replays a finished job from the database: a run's output + done, or a test job's per-case results
    (never any output of a case: students must not see what a hidden case printed) + done."""
    if state["kind"] == "run":
        if state["output"] and not full_output:
            await ws.send_json({"type": "output", "data": state["output"]})
        event = _done_event(state)
        if full_output:
            event["output"] = state["output"]
        await ws.send_json(event)
        return
    for event in grading_service.progress_events(state["results"] or []):
        await ws.send_json(event)
    await ws.send_json(_done_event(state))


def _open_run(token: Optional[str], execution_id: int) -> dict[str, Any]:
    with SessionLocal() as db:
        user = _user(db, token)
        # Students watch their own runs; an instructor watches their own "try this test case" runs.
        ex = db.scalar(select(Execution).where(Execution.id == execution_id, Execution.student_id == user.id)) \
            if user.role in (Role.STUDENT, Role.INSTRUCTOR) else None
        if ex is None:  # someone else's run looks like it doesn't exist
            raise NotFoundError("Execution not found", "EXECUTION_NOT_FOUND")
        return _execution_state(ex)


def _run_state(execution_id: int) -> dict[str, Any]:
    with SessionLocal() as db:
        return _execution_state(db.get(Execution, execution_id))


def _open_class(token: Optional[str], class_id: int) -> dict[str, Any]:
    with SessionLocal() as db:
        user = _user(db, token)
        class_service.get_class_for_member(db, class_id, user)  # its instructor or an approved student
        return {"user_id": user.id, "name": user.full_name, "is_student": user.role == Role.STUDENT}


def _open_monitor(token: Optional[str], session_id: int) -> dict[str, Any]:
    with SessionLocal() as db:
        user = _user(db, token)
        if user.role != Role.INSTRUCTOR:
            raise ForbiddenError("Only the instructor can monitor a lab", "FORBIDDEN_ROLE")
        session = db.get(LabSession, session_id)
        if session is None:
            raise NotFoundError("Lab session not found", "SESSION_NOT_FOUND")
        class_service.get_owned_class(db, session.class_id, user)
        return {"user_id": user.id, "class_id": session.class_id}


def _presence_up(class_id: int, user_id: int, name: str) -> None:
    if not monitor_service.presence_touch(class_id, user_id):
        return
    with SessionLocal() as db:
        monitor_service.emit_for_class(db, class_id, "online", user_id, name)


def _presence_down(class_id: int, user_id: int, name: str) -> None:
    monitor_service.presence_remove(class_id, user_id)
    with SessionLocal() as db:
        monitor_service.emit_for_class(db, class_id, "offline", user_id, name)


# -------------------------------------------------------------------- helpers

def _close_code(exc: AppError) -> int:
    return {401: 4401, 403: 4403, 404: 4404}.get(exc.status_code, 4400)


async def _reject(ws: WebSocket, exc: AppError) -> None:
    with contextlib.suppress(Exception):
        await ws.send_json({"type": "error", "code": exc.code, "detail": exc.detail})
        await ws.close(code=_close_code(exc))


async def _guard(ws: WebSocket, fn: Callable[..., Any], *args: Any) -> Any:
    """Runs a sync check in the threadpool; on a refusal, tells the client why and closes (returns None)."""
    try:
        return await run_in_threadpool(fn, *args)
    except AppError as exc:
        await _reject(ws, exc)
        return None


async def _cleanup(fn: Callable[..., Any], *args: Any) -> None:
    """Runs blocking clean-up work to completion even if this handler is being cancelled (server shutdown, or a
    disconnect that cancels the handler). Without the shield, a cancelled handler would skip e.g. marking the
    student offline and leave them "online" until the sweeper noticed."""
    task = asyncio.ensure_future(run_in_threadpool(fn, *args))
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        pass  # the clean-up keeps running in the background
    except Exception:
        logger.exception("websocket clean-up failed")


async def _close_redis(client, pubsub) -> None:
    with contextlib.suppress(Exception, asyncio.CancelledError):
        await pubsub.aclose()
        await client.aclose()


async def _finish(ws: WebSocket) -> None:
    if ws.application_state == WebSocketState.CONNECTED:
        with contextlib.suppress(Exception):
            await ws.close()


def _subscribe(channel: str):
    client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return client, client.pubsub(ignore_subscribe_messages=True), channel


async def _forward(ws: WebSocket, pubsub) -> None:
    while True:
        message = await pubsub.get_message(timeout=1.0)
        if message is not None:
            await ws.send_json(json.loads(message["data"]))


async def _receive(ws: WebSocket, on_message: Optional[Callable[[], Awaitable[None]]], idle: Optional[float]) -> None:
    """Reads the client's messages (heartbeats). Answers each with a pong."""
    while True:
        try:
            await asyncio.wait_for(ws.receive_text(), idle)
        except asyncio.TimeoutError:
            await ws.close(code=4408)
            return
        if on_message is not None:
            await on_message()
        await ws.send_json({"type": "pong"})


async def _watchdog(ws: WebSocket, check: Callable[[], Any]) -> None:
    """Closes the socket if the user is signed out / signed in elsewhere / loses access."""
    while True:
        await asyncio.sleep(REVALIDATE_SECONDS)
        try:
            await run_in_threadpool(check)
        except AppError as exc:
            await _reject(ws, exc)
            return


async def _serve(tasks: list[asyncio.Task]) -> None:
    """Runs until the first task ends (client left, idle, or access revoked), then stops the rest."""
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, Exception):
                await t


# ------------------------------------------------------------------ /ws/run

async def _relay_client_messages(ws: WebSocket, redis_client, execution_id: int) -> None:
    """Interactive runs: the owner's {"type":"stdin","data"} / {"type":"eof"} / {"type":"stop"} messages go to the
    worker over exec_in:{id}. Invalid messages get an error event (the socket stays open); at most
    MAX_INPUTS lines per run, counted in Redis so that reconnecting does not reset the count."""
    while True:
        message = await ws.receive()
        if message["type"] == "websocket.disconnect":
            return
        parsed, error = interactive_service.parse_client_message(message.get("text") or message.get("bytes"))
        if parsed is None:
            await ws.send_json({"type": "error", "code": error[0], "detail": error[1]})
            continue
        if parsed["type"] == "stdin":
            key = interactive_service.count_key(execution_id)
            count = await redis_client.incr(key)
            if count == 1:
                await redis_client.expire(key, interactive_service.STREAM_MAX_SEC)
            if count > interactive_service.MAX_INPUTS:
                await ws.send_json({"type": "error", "code": "INPUT_LIMIT",
                                    "detail": f"At most {interactive_service.MAX_INPUTS} inputs per run"})
                continue
        elif parsed["type"] == "stop":  # also leave a note: a Stop sent while the run is queued must not be lost
            await redis_client.set(interactive_service.stop_key(execution_id), "1", ex=interactive_service.STREAM_MAX_SEC)
        await redis_client.publish(interactive_service.control_channel(execution_id), json.dumps(parsed))


@router.websocket("/ws/run/{execution_id}")
async def ws_run(ws: WebSocket, execution_id: int) -> None:
    """Live output of one run (owner only): status / output / done. A run that already finished is replayed
    from the database. If `done` carries an `output` field, it is the complete output: prefer it.

    Interactive runs (mode "interactive") also send {"type":"input_request"} whenever the program waits at input(),
    and accept {"type":"stdin","data":"..."} (one line, max 1,000 chars, max 200 per run), {"type":"eof"} and
    {"type":"stop"} from the owner. The typed lines are echoed back as output after their prompt."""
    await ws.accept()
    state = await _guard(ws, _open_run, ws.cookies.get(settings.COOKIE_NAME), execution_id)
    if state is None:
        return

    client, pubsub, channel = _subscribe(f"exec:{execution_id}")
    receiver = None
    try:
        await pubsub.subscribe(channel)  # subscribe BEFORE reading the state, so no event can slip between
        state = await run_in_threadpool(_run_state, execution_id)
        if state["finished"]:
            await _send_final(ws, state, full_output=False)
            return
        await ws.send_json({"type": "status", "status": state["status"]})

        loop = asyncio.get_running_loop()
        started = next_poll = loop.time()
        interactive = state["mode"] == "interactive"
        max_seconds = interactive_service.STREAM_MAX_SEC if interactive else RUN_STREAM_MAX_SECONDS
        receiver = asyncio.create_task(_relay_client_messages(ws, client, execution_id)) if interactive else None
        while loop.time() - started < max_seconds:
            message = await pubsub.get_message(timeout=1.0)
            if message is not None:
                event = json.loads(message["data"])
                await ws.send_json(event)
                if event.get("type") == "done":
                    return
            if loop.time() >= next_poll + RUN_POLL_SECONDS:
                next_poll = loop.time()
                state = await run_in_threadpool(_run_state, execution_id)
                if state["finished"]:  # the done event was missed: send the final result from the database
                    await _send_final(ws, state, full_output=True)
                    return
        await ws.send_json({"type": "error", "code": "RUN_STREAM_TIMEOUT",
                            "detail": "Still running; fetch GET /executions/{id} for the result"})
    except WebSocketDisconnect:
        pass
    finally:
        if receiver is not None:
            receiver.cancel()
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, Exception):
                await receiver
        await _close_redis(client, pubsub)
        await _finish(ws)


# ---------------------------------------------------------------- /ws/class

@router.websocket("/ws/class/{class_id}")
async def ws_class(ws: WebSocket, class_id: int) -> None:
    """Class events (session_opened / session_closed / activity_published) for the class's approved students
    and its instructor. Students must send any text (e.g. {"type":"ping"}) at least every 30 s: that is their
    presence heartbeat; each one is answered with {"type":"pong"}."""
    await ws.accept()
    token = ws.cookies.get(settings.COOKIE_NAME)
    info = await _guard(ws, _open_class, token, class_id)
    if info is None:
        return

    client, pubsub, channel = _subscribe(session_service.class_channel(class_id))
    is_student = info["is_student"]
    try:
        await pubsub.subscribe(channel)
        if is_student:
            await run_in_threadpool(_presence_up, class_id, info["user_id"], info["name"])
        await ws.send_json({"type": "connected"})

        async def heartbeat() -> None:
            await run_in_threadpool(_presence_up, class_id, info["user_id"], info["name"])

        await _serve([
            asyncio.create_task(_forward(ws, pubsub)),
            asyncio.create_task(_receive(ws, heartbeat if is_student else None,
                                         STUDENT_IDLE_SECONDS if is_student else None)),
            asyncio.create_task(_watchdog(ws, lambda: _open_class(token, class_id))),
        ])
    finally:
        if is_student:
            await _cleanup(_presence_down, class_id, info["user_id"], info["name"])
        await _close_redis(client, pubsub)
        await _finish(ws)


# -------------------------------------------------------------- /ws/monitor

@router.websocket("/ws/monitor/{lab_session_id}")
async def ws_monitor(ws: WebSocket, lab_session_id: int) -> None:
    """Live feed for the instructor who owns the lab session: run / run_done / saved / submitted / online /
    offline events about the class's students. Pair it with GET /sessions/{id}/monitor for the full picture."""
    await ws.accept()
    token = ws.cookies.get(settings.COOKIE_NAME)
    info = await _guard(ws, _open_monitor, token, lab_session_id)
    if info is None:
        return

    client, pubsub, channel = _subscribe(monitor_service.monitor_channel(lab_session_id))
    try:
        await pubsub.subscribe(channel)
        await ws.send_json({"type": "connected"})
        await _serve([
            asyncio.create_task(_forward(ws, pubsub)),
            asyncio.create_task(_receive(ws, None, None)),
            asyncio.create_task(_watchdog(ws, lambda: _open_monitor(token, lab_session_id))),
        ])
    finally:
        await _close_redis(client, pubsub)
        await _finish(ws)
