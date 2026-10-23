"""Interactive runs: the program pauses at input() and the student types the value live. Pure helpers shared by the
WebSocket (api), the Celery task and the sandbox: limits, Redis key names, the client-message rules and the filter that
turns the sandbox's "I am waiting for input" marker into an event. No Docker, no database.

How it fits together:
  student --WebSocket {"type":"stdin"|"eof"|"stop"}--> api --Redis exec_in:{id}--> worker --container stdin--> program
  program --input() prints the prompt, then a marker line--> container log --> worker strips the marker and publishes
  {"type":"input_request"} on exec:{id} --> api --WebSocket--> student
"""
import json
from typing import Any, Optional

# ----------------------------------------------------------------------------------------------------- limits
MAX_INPUT_CHARS = 1000    # one typed line
MAX_INPUTS = 200          # typed lines per run
INPUT_WAIT_SEC = 120      # how long the program may wait for ONE input before it is stopped
TOTAL_SEC = 300           # wall clock of a whole interactive run (5 minutes)
CPU_SEC = 10              # CPU time of the program (RLIMIT_CPU): waiting for the student costs none
CONTAINER_TTL_SEC = TOTAL_SEC + 30  # the orphan reaper must not remove a container younger than this
STREAM_MAX_SEC = TOTAL_SEC + 120    # how long /ws/run/{id} follows an interactive run (queue wait included)

INPUT_REQUEST = "INPUT_REQUEST"


def control_channel(execution_id: int) -> str:
    """The student's typed lines / eof / stop, from the api to the worker."""
    return f"exec_in:{execution_id}"


def stop_key(execution_id: int) -> str:
    """Set when the student presses Stop: a stop sent while the run is still queued must not be lost."""
    return f"exec_stop:{execution_id}"


def count_key(execution_id: int) -> str:
    return f"exec_in_count:{execution_id}"


def marker_for(nonce: str) -> str:
    return f"\x1e{nonce}:{INPUT_REQUEST}\n"


# ------------------------------------------------------------------------------------- the marker filter

class InputFilter:
    """Cuts the input-request marker out of the program's output stream.

    feed(text) returns the stream in order as [("text", str) | ("input", "")]. A marker may arrive split over two
    chunks, so a possible beginning of one is held back until the next chunk (flush() releases it at the end).
    The marker is not a secret: a program that prints it (it can read it from /proc/self/cmdline) only causes a
    harmless "input_request" event, and any output printed after it shows that it was not really waiting."""

    def __init__(self, nonce: str) -> None:
        self.marker = marker_for(nonce)
        self.held = ""

    def feed(self, text: str) -> list[tuple[str, str]]:
        buf = self.held + text
        self.held = ""
        events: list[tuple[str, str]] = []
        while True:
            at = buf.find(self.marker)
            if at < 0:
                break
            if at:
                events.append(("text", buf[:at]))
            events.append(("input", ""))
            buf = buf[at + len(self.marker):]
        start = buf.rfind("\x1e")
        if start >= 0 and self.marker.startswith(buf[start:]):
            self.held, buf = buf[start:], buf[:start]
        if buf:
            events.append(("text", buf))
        return events

    def flush(self) -> str:
        held, self.held = self.held, ""
        return held


# ----------------------------------------------------------------------------- messages from the student

def parse_client_message(raw: Any) -> tuple[Optional[dict], Optional[tuple[str, str]]]:
    """(message, None) for a valid client message, or (None, (code, detail)).

    {"type":"stdin","data":"text"}  one typed line (no newline inside; a trailing one is dropped), at most 1,000 chars
    {"type":"eof"}                  close stdin: input() raises EOFError
    {"type":"stop"}                 kill the program"""
    try:
        message = json.loads(raw) if isinstance(raw, (str, bytes)) else raw
    except ValueError:
        return None, ("INVALID_MESSAGE", "Messages must be JSON")
    if not isinstance(message, dict):
        return None, ("INVALID_MESSAGE", "Messages must be JSON objects")
    kind = message.get("type")
    if kind in ("eof", "stop"):
        return {"type": kind}, None
    if kind != "stdin":
        return None, ("UNKNOWN_MESSAGE", 'type must be "stdin", "eof" or "stop"')
    data = message.get("data")
    if not isinstance(data, str):
        return None, ("INVALID_MESSAGE", "data must be a string")
    data = data.rstrip("\r\n")  # a trailing line break is not part of the line
    if "\n" in data or "\r" in data:
        return None, ("INVALID_INPUT", "Send one line per message")
    if len(data) > MAX_INPUT_CHARS:
        return None, ("INPUT_TOO_LONG", f"A line can have at most {MAX_INPUT_CHARS} characters")
    return {"type": "stdin", "data": data}, None
