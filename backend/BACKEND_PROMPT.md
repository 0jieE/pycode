# BUILD PROMPT — Backend of the LAN-Based Laboratory Management System

You are building the **backend** of a capstone project: *"LAN-Based Laboratory Management System with Integrated Python Coding Environment for BSIT Students of Colegio de Kidapawan."*
Work inside the `backend/` folder only. The `frontend/` folder (React + Vite + Tailwind + CodeMirror 6) is built later and will call this API.

Build **one phase at a time**. At the end of each phase: run the tests, show me what was built, tell me how to try it, and **stop and wait for my "go"** before starting the next phase.

---

## 1. What the system does

- Runs **only on the school LAN**. No internet is needed at runtime. Never load anything from a CDN or call an external service.
- **Roles:**
  - **Admin** manages accounts.
  - **Instructor** creates classes, invite codes, lab sessions and activities, approves students, and monitors live.
  - **Student** joins classes, writes Python in a personal workspace, runs it, and submits.
- **Invite codes** have an on/off switch and a validity window. Joining with a code creates a **pending** enrollment. The instructor must **approve** it manually.
- **Lab sessions** are run by batch (about 40 minutes). The instructor can **open or close access in real time**. When a session is closed, the student's workspace becomes read-only and Run is blocked.
- Each student has a **workspace per class**: a file tree with folders and multiple `.py`/`.txt`/`.csv`/`.json`/`.md` files. Each activity is a folder in it.
- **Run** executes the chosen entry file in a **fresh, locked-down Docker container per run**. Output streams live to the student over WebSocket.
- **Target:** 120 concurrent users on one server (i7, 8 cores, 16 GB) without crashing.

## 2. Stack (fixed — do not substitute)

| Layer | Choice |
|---|---|
| API | **FastAPI** (Python 3.12), Pydantic v2 |
| ORM / migrations | **SQLAlchemy 2.0** (sync, `def` endpoints) + **Alembic** |
| Database | **MySQL 8** (driver: `pymysql`) |
| Queue | **Celery 5** with **Redis 7** as broker + result backend + pub/sub |
| Sandbox | **Docker** via the `docker` Python SDK |
| Auth | JWT (`python-jose` or `pyjwt`) in an **httpOnly cookie**, passwords hashed with **argon2** (`passlib[argon2]` or `argon2-cffi`) |
| Server | `gunicorn -k uvicorn.workers.UvicornWorker -w 4` behind **Nginx** |
| Tests | `pytest` + FastAPI `TestClient`; load test with **Locust** |

**Dev machine is Windows 11 with Docker Desktop (WSL2).** Celery does not run correctly on native Windows, so **everything runs through `docker compose`**:
- Services: `api`, `worker`, `beat`, `redis`, `mysql`, `nginx`.
- The `api` service gets hot reload via a bind mount plus `uvicorn --reload` in dev.
- **Only the `worker` service** mounts `/var/run/docker.sock`. Never mount it on `api`.

## 3. Folder structure (create exactly this)

```
backend/
├── app/
│   ├── main.py
│   ├── core/        config.py  database.py  security.py  deps.py  ratelimit.py
│   ├── models/      user.py  classroom.py  enrollment.py  invite_code.py  lab_session.py
│   │                activity.py  workspace.py  submission.py  execution.py  activity_log.py
│   ├── schemas/     (Pydantic models, one file per area)
│   ├── api/v1/      auth.py  users.py  classes.py  enrollments.py  sessions.py
│   │                activities.py  workspace.py  run.py  monitor.py  ws.py
│   ├── services/    auth_service.py  user_service.py  enrollment_service.py  session_service.py
│   │                activity_service.py  workspace_service.py  execution_service.py
│   │                monitor_service.py  audit_service.py
│   └── worker/      celery_app.py  tasks.py  sandbox.py
├── sandbox-image/   Dockerfile  boot.py
├── alembic/  alembic.ini
├── tests/
├── loadtest/locustfile.py
├── nginx/nginx.conf
├── docker-compose.yml   Dockerfile   requirements.txt   .env.example   README.md
```

**Rules:**
- Code flows **router → service → model**. Routers only validate input, call one service and return a schema. All business rules live in services.
- Every endpoint is under `/api/v1`.
- All config comes from `.env` via `pydantic-settings`. No secrets in code.
- Times are stored in UTC. The API returns ISO 8601.

## 4. Database schema

Use InnoDB and `utf8mb4`. Every table has `id` (BIGINT PK), `created_at` and `updated_at`.

- **users**
  - username (unique), password_hash, full_name, student_no (nullable, unique)
  - role ENUM('admin','instructor','student'), is_active
  - **current_session_id** (string, nullable): used to block account sharing
- **classes**
  - instructor_id → users, name, section, school_year, is_archived
- **invite_codes**
  - class_id, code (unique, 8 chars, no ambiguous characters)
  - valid_from, valid_until, is_active
  - max_uses (nullable), use_count
- **enrollments**
  - class_id, student_id
  - status ENUM('pending','approved','rejected','removed')
  - invite_code_id, reviewed_by, reviewed_at
  - UNIQUE(class_id, student_id)
- **lab_sessions**
  - class_id, batch_name, starts_at, ends_at
  - is_open, opened_at, closed_at
- **activities**
  - class_id, title, instructions (TEXT), starter_files (JSON: list of {path, content})
  - due_at, is_published
- **workspaces**
  - student_id, class_id, UNIQUE(student_id, class_id)
- **workspace_files**
  - workspace_id, path (VARCHAR 255), is_folder, content (MEDIUMTEXT), size_bytes
  - UNIQUE(workspace_id, path)
- **file_versions**
  - file_id, content, saved_at
  - Keep only the last 20 per file.
- **submissions**
  - activity_id, student_id, submitted_at
  - status ENUM('submitted','late')
  - UNIQUE(activity_id, student_id). Resubmitting replaces the old one.
- **submission_files**
  - submission_id, path, content
  - A frozen snapshot of the activity folder.
- **executions**
  - student_id, workspace_id, activity_id (nullable), lab_session_id (nullable)
  - entry_path, stdin (TEXT), output (MEDIUMTEXT), exit_code
  - status ENUM('queued','running','ok','error','timeout','memory_exceeded','output_limit','system_error')
  - duration_ms, queued_at, started_at, finished_at
- **activity_logs**
  - user_id, action, details (JSON), ip_address

**Indexes:**
- `workspace_files(workspace_id, path)`
- `executions(student_id, created_at)`
- `executions(status)`
- `enrollments(class_id, status)`
- `activity_logs(user_id, created_at)`

## 5. Business rules (enforce in services; each gets a test)

### Auth and access
- **Login** creates a new random `current_session_id`, stores it on the user and puts it in the JWT.
  - Any request whose token carries an older session id gets **401 "Signed in on another device"**.
  - This makes logging in on another PC kick out the first one.
- `deps.require_role(*roles)` protects every route.
- **Students** can only touch their own workspace, executions and submissions.
- **Instructors** can only touch classes they own, plus **read-only** views of workspaces of students enrolled in those classes.
- **Admins** manage users only. They cannot read student code.
- Inactive users cannot log in.

### Invite codes and enrollment
- A code is usable only if all of these hold:
  - `is_active` is true
  - `valid_from <= now <= valid_until`
  - `use_count < max_uses` (when set)
- Joining creates a `pending` enrollment. Joining the same class twice returns the existing row and never creates a duplicate.
- On **approval**, create the student's `workspace` for that class (if missing) and copy the starter files of every published activity into it.

### Lab sessions
- Only one open session per class at a time.
- **Closing a session:**
  - Sets `is_open=false`.
  - Publishes `{"type":"session_closed"}` on Redis channel `class:{class_id}`.
  - Every connected student receives it over WebSocket.
- **While no session is open for the class:**
  - Workspace write endpoints and Run return **403 "Laboratory access is closed"**.
  - Reading still works.

### Activities
- **Publishing** creates the folder `"{title}/"` with the starter files in every **approved** student's workspace for that class.
- If a path already exists, never overwrite student files.

### Workspace (`workspace_service.py`)
- **Path validation:**
  - Normalize with `PurePosixPath`.
  - Reject absolute paths, `..`, backslashes, empty segments, names starting with `.`, and paths longer than 255 characters.
- **Extensions:** allow only `.py`, `.txt`, `.csv`, `.json`, `.md`.
- **Limits:**
  - 100 KB per file
  - 2 MB per workspace
  - 100 files per workspace
- **Save** (`PUT`) takes `{content, last_updated_at}`. If `last_updated_at` doesn't match the DB value, return **409 Conflict**.
- **Manual save:** `?version=true` also writes a `file_versions` row (prune to 20). Autosave never writes a version.
- **Rename/move** a folder: rename every path under it in one transaction.
- **Delete** a folder: delete everything under it.

### Submissions
- Submitting snapshots every file under the activity folder into `submission_files`.
- Mark the submission `late` if it arrives after `due_at`.

### Run (`execution_service.py`)
- **Reject** with **429** when either holds:
  - The student already has an execution in `queued` or `running`.
  - The student's last run was less than 3 seconds ago (tracked with a Redis key with TTL).
- **Reject** with **503 "Server busy, try again"** when the Celery queue length is over 150.
- **Otherwise:**
  1. Create the `executions` row (`queued`).
  2. Enqueue `run_code.delay(execution_id)`.
  3. Return `{execution_id, queue_position}`.

### Audit
- Write `activity_logs` rows for:
  - login and logout
  - failed login
  - enrollment approve/reject
  - session open/close
  - submit
  - run

## 6. Sandbox (use my existing, already-tested code)

I already have a tested `sandbox-image/boot.py`, `sandbox-image/Dockerfile`, `app/worker/sandbox.py` and `app/worker/tasks.py`. I will paste or copy them in. **Use them as-is.** Only adapt imports and model names to match this project, and do not weaken any limit.

They work like this:
- **One fresh container per run** from image `lab-python-runner:1`, deleted afterwards (`finally: remove(force=True)`).
- **Limits on every container:**
  - `network_disabled`
  - 128 MB memory, no swap
  - 0.5 CPU
  - `pids_limit=64`
  - `read_only` root filesystem
  - tmpfs `/workspace` (10 MB) and `/tmp` (5 MB)
  - `ulimit fsize=1MB` and `nofile=64`
  - `cap_drop=ALL`, `no-new-privileges`
  - user `1000:1000`
  - `init=True`
- **Files reach the container through stdin:** a length line, then a JSON payload `{files, entry, stdin}`. `boot.py` writes them into the tmpfs and runs the entry file from its own folder.
- **Wall-clock timeout** is 10 s. **Output cap** is 64 KB, after which the container is killed.
- **Result statuses:** `ok`, `error`, `timeout`, `memory_exceeded`, `output_limit`, `system_error`.
- `reap_orphans()` removes runner containers older than 30 s. Schedule it every 60 s with **Celery beat**.

**Celery settings:**
```
worker_concurrency      = env CELERY_CONCURRENCY (default 6)
worker_prefetch_multiplier = 1
task_acks_late          = True
task_soft_time_limit    = 12
task_time_limit         = 15
worker_max_tasks_per_child = 200
```

**Task flow:**
1. Load the workspace files from MySQL.
2. Set the execution to `running` and set `started_at`.
3. Call `run_in_sandbox`, publishing each output chunk to Redis channel `exec:{id}` as `{"type":"output","data":...}`.
4. Save the result and set `finished_at`.
5. Publish `{"type":"done", status, exit_code, duration_ms}`.

## 7. Real-time (WebSockets)

Authenticate WebSockets with the same JWT cookie. Use `redis.asyncio` pub/sub inside the WebSocket handler, so any of the 4 API processes can deliver any message.

- `WS /api/v1/ws/run/{execution_id}`
  - Owner only.
  - Streams `status` / `output` / `done`.
  - If the execution has already finished when the client connects, send the stored output plus `done` immediately.
- `WS /api/v1/ws/class/{class_id}`
  - Approved students of that class.
  - Receives `session_opened`, `session_closed` and `activity_published`.
- `WS /api/v1/ws/monitor/{lab_session_id}`
  - Owning instructor only.
  - Receives live events: student ran code (status, duration), saved a file, submitted, came online or went offline.
  - Every student action publishes to `monitor:{lab_session_id}`.

**Online presence:** keep a Redis set `online:{class_id}` with a heartbeat. Remove a student who hasn't sent a heartbeat in 30 s.

## 8. Endpoints

```
POST   /auth/login            POST /auth/logout            GET /auth/me
# admin
GET/POST /users               PATCH /users/{id}            POST /users/{id}/reset-password
POST   /users/import          # CSV of students: student_no, full_name, username, temp password
# instructor
GET/POST /classes             GET/PATCH /classes/{id}
GET/POST /classes/{id}/invite-codes      PATCH /invite-codes/{id}   # toggle, change window
GET    /classes/{id}/enrollments?status=pending
PATCH  /enrollments/{id}      # {"action":"approve"|"reject"|"remove"}
POST   /classes/{id}/sessions               PATCH /sessions/{id}/open   PATCH /sessions/{id}/close
GET    /classes/{id}/sessions/current
GET/POST /classes/{id}/activities           GET/PATCH /activities/{id}  POST /activities/{id}/publish
GET    /activities/{id}/submissions         GET /submissions/{id}
GET    /classes/{id}/students/{sid}/workspace          # read-only tree
GET    /classes/{id}/students/{sid}/workspace/files/{fid}
GET    /sessions/{id}/monitor               # snapshot: each student's online flag, last run, last save, submitted?
# student
POST   /enroll                # {"code": "..."}
GET    /my/classes
GET    /workspace/{class_id}/tree
GET    /workspace/files/{file_id}
POST   /workspace/{class_id}/files          # {path, is_folder, content?}
PUT    /workspace/files/{file_id}?version=  # {content, last_updated_at}
PATCH  /workspace/files/{file_id}           # {new_path}
DELETE /workspace/files/{file_id}
GET    /workspace/files/{file_id}/versions  GET /workspace/versions/{vid}
POST   /workspace/{class_id}/run            # {entry_path, stdin}
GET    /executions/{id}
POST   /activities/{id}/submit
GET    /health                              # checks DB, Redis, Docker
```

**Error format everywhere:** `{"detail": "...", "code": "SNAKE_CASE_CODE"}`.

**Pagination:** list endpoints take `?page=&size=` (max 100).

## 9. Performance and stability (for 120 concurrent users)

- **gunicorn:** 4 workers. **SQLAlchemy:** `pool_size=10`, `max_overflow=10`, `pool_pre_ping=True`, `pool_recycle=1800`. **MySQL:** `max_connections=200`.
- **Tree endpoint:** returns paths and metadata only, never file content.
- **Nginx:**
  - WebSocket upgrade headers on `/api/v1/ws/`.
  - `client_max_body_size 256k`.
  - `limit_req` zone on `/api/v1/workspace/*/run` (2 r/s per IP, burst 5).
  - gzip for JSON.
- **docker compose:**
  - `restart: always` and healthchecks on every service.
  - MySQL and Redis data in named volumes.
- **Logging:** structured logs to stdout. Never log passwords, tokens or student code.

## 10. Seed data and README

- `python -m app.seed` creates:
  - 1 admin, 2 instructors, 40 students
  - 1 class with an active invite code
  - 1 published activity with starter files
  - It prints the credentials.
- **README:**
  - setup on Windows with Docker Desktop
  - building the sandbox image (`docker build -t lab-python-runner:1 sandbox-image/`)
  - `docker compose up`
  - running migrations, seed, tests and the Locust test
  - LAN deployment notes: Ubuntu server, static IP, open port 80 only

## 11. Phases (stop after each one)

### Phase 1 — Foundation
- docker-compose (api, mysql, redis, nginx), config, database, Alembic.
- All models plus the first migration.
- `/health`.
- **Done when** `docker compose up` works, the migration runs and `/health` returns OK.

### Phase 2 — Auth & users
- argon2, JWT cookie, single-session enforcement, `require_role`.
- Admin user CRUD plus CSV import.
- Audit logs, seed script.
- **Tests:** login, wrong password, inactive user, second login kicks the first, role blocking.

### Phase 3 — Classes, invite codes, enrollments
- Code validity rules and the approval flow.
- Workspace auto-created on approval.
- **Tests:** expired code, inactive code, duplicate join, approve/reject, instructor can't touch another instructor's class.

### Phase 4 — Lab sessions & activities
- Open/close plus the Redis event, the "access closed" guard, publish into workspaces.
- **Tests:** a write while closed returns 403, only one open session, publish doesn't overwrite student files.

### Phase 5 — Workspace
- Tree, CRUD, rename/move folders, versions, quotas, conflict detection.
- Submissions with snapshot.
- **Tests:**
  - path traversal (`../x.py`, `/etc/x.py`, `a\\b.py`)
  - bad extension, oversize file, quota exceeded
  - 409 conflict
  - folder rename
  - snapshot unaffected by later edits

### Phase 6 — Sandbox & Celery
- Add `worker` and `beat` to compose. Copy in my sandbox files.
- Run endpoint with per-student, rate-limit and queue-length guards.
- **Tests:** port my abuse tests into `tests/test_sandbox.py`. Each must produce the right status, and **0 leftover containers** must remain afterwards:
  - normal multi-file run with import, csv and input
  - syntax error
  - infinite loop
  - print flood
  - memory bomb
  - fork bomb
  - network attempt
  - write to a read-only path
  - 5 MB file

### Phase 7 — Real-time
- The three WebSockets, presence and the monitor snapshot endpoint.
- **Tests:** run output arrives over WS, closing a session pushes `session_closed`, the monitor receives run events.

### Phase 8 — Hardening & load test
- Gunicorn config, final Nginx config, the Locust file.
- **Locust scenario:**
  - 120 users
  - autosave every 5 s
  - run every 30 s
  - plus a spike task where all users run at once
- Report p50/p95 response times, run turnaround and error count.
- **Targets:**
  - normal run p95 ≤ 3 s
  - 120-run spike drains ≤ 20 s
  - 0 server errors

## 12. Quality bar

- Type hints everywhere. Small functions. No business logic in routers.
- No `print`; use `logging`.
- Every rule in section 5 has at least one pytest.
- Don't add libraries or services beyond section 2 without asking me first.
- If something in this spec conflicts or is unclear, **ask me before guessing**.

**Start with Phase 1 now.**
