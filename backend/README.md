# Lab Management System — Backend

LAN-based laboratory management with an integrated Python coding environment (BSIT, Colegio de Kidapawan).
FastAPI · MySQL 8 · Redis · Celery · Docker sandbox · Nginx. Everything runs through `docker compose`.
No internet is needed at runtime.

```
browser ── Nginx :80 ── api (gunicorn ×4, FastAPI) ── MySQL
                          │  └─ Redis (pub/sub, rate limits, presence, Celery broker)
                          ├─ lab runs ──────► worker             (Celery, queue "celery",      CELERY_CONCURRENCY)       ─┐ Docker socket
                          ├─ practice runs ─► practice-worker    (Celery, queue "practice",    PRACTICE_CONCURRENCY)      │
                          └─ interactive ───► interactive-worker (Celery, queue "interactive", threads, INTERACTIVE_CONCURRENCY) ┘ ─► one fresh
                                         beat (orphan cleanup, Docker heartbeat, presence sweep)   locked-down container per Run
```

Only the three workers (`worker`, `practice-worker`, `interactive-worker`) mount the Docker socket. The `api` and `beat` containers never
import the Docker SDK.

---

## 1. Setup on Windows 11 (Docker Desktop, WSL2)

The repository holds both parts: `backend/` (this folder) and `frontend/`. The frontend's build (`frontend/dist`) is
committed, so a server needs only Git and Docker Desktop, not Node.

```powershell
git clone https://github.com/0jieE/pycode.git
cd pycode/backend
copy .env.example .env          # then edit .env: MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD, SECRET_KEY
docker build -t lab-python-runner:1 sandbox-image/     # the sandbox image (once; again if sandbox-image/ changes)
docker compose up -d --build                           # api, worker, practice-worker, interactive-worker, beat, redis, mysql, nginx
docker compose exec api alembic upgrade head           # create the tables
docker compose exec api python -m app.seed             # demo data (prints every account's password once) + the tutorial lessons
```

Open http://localhost/api/v1/health → `{"status":"ok","checks":{"database":"ok","redis":"ok","docker":"ok"}}`
and the interactive API docs at http://localhost/api/v1/docs.

**Updating** an installed copy: `git pull`, then `docker compose up -d --build` and
`docker compose exec api alembic upgrade head`; if `sandbox-image/` changed, rebuild it first
(`docker build -t lab-python-runner:1 sandbox-image/`). `.env`, the generated credential files and database backups are
never in the repository (see `.gitignore`).
(Port 80 busy on your PC? Set `NGINX_PORT=8080` in `.env`.)

Development mode hot-reloads the api (`uvicorn --reload`, code bind-mounted). Restart the worker after editing
task code: `docker compose restart worker practice-worker interactive-worker`.

`seed` creates 1 admin, 2 instructors, 40 students, a class with an active invite code, one published activity and
one batch of 5 student **registration codes** (printed once; see section 3). On a re-run the codes cannot be shown
again, because only their hashes are stored. Re-running it never changes existing passwords. `seed_credentials.txt` (if present) holds the output of
a previous run: delete it once you no longer need it.

**Demo data (for presentations).** `docker compose exec worker python -m demo.build --yes` **deletes everything** and
builds a full semester (SY 2026-2027, classes from 10 Aug; "today" is the day you run it, or `--today YYYY-MM-DD`):
- **People:** 1 admin, 3 instructors, and 130 students in BSIT 1A-1C and 2A-2B, plus 6 irregular students.
- **Classes:** 15, five per instructor, each with 26-27 students, invite codes and a few pending or rejected requests.
- **Activities:** 3 per class, each with 4 test cases. Every student submitted every activity (some late), graded by
  the real engine. Their workspaces, runs and Test history match what they submitted.
- **Lab sessions:** weekly up to today plus 2 upcoming per class, in two computer labs, with every sign-in.
- **Also included:** tutorial progress, Practice files, a batch of 8 unused registration codes, and an audit trail.

It runs in the worker because it first grades every version of every activity (`demo/content.py`) in the sandbox, and
stops before deleting anything if a correct solution fails. Passwords are random: they, the invite codes and the
registration codes are written to `seed_credentials.txt`. The same `--seed` gives the same data. `app.seed` is the
small demo from before; do not run it on top of this one.

**A separate stack for the frontend's Playwright tests** (so they never touch the demo):

```powershell
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build      # project "lab-e2e", Nginx on :8081
docker compose -f docker-compose.yml -f docker-compose.e2e.yml exec api python -m app.e2e_seed
```

It has its own containers, MySQL and Redis volumes and network (`172.28.0.0/24` is the main stack's, `172.29.0.0/24`
this one's); only the sandbox image and Docker itself are shared. The api migrates on start. `app.e2e_seed` creates or
resets `admin`, `instructor1`, `instructor2` and `student01`-`student29` ("Instructor One", "Student 01", ...) with new
random passwords on every run, makes sure the labs `E2E Lab 1` and `E2E Lab 2` exist (every session needs a
lab), loads the tutorial, and writes `e2e_credentials.txt` (`username  role  password`, plus the labs' ids). It
refuses to run outside this stack (`E2E=1`), since it would reset the demo's `admin`. Stop it with `... down`, or
`... down -v` to delete its data. It uses roughly as much memory as the main stack; stop it when not testing.
While it runs, a backend `pytest` that checks for leftover sandbox containers can see the e2e stack's runs, so
don't run both at the same moment.

## 2. Tests

```powershell
docker compose exec worker pytest        # EVERYTHING, including the sandbox abuse tests (~8 min)
docker compose exec api pytest           # same, but the 55 tests that need the Docker socket are skipped
```

Run one pytest at a time: they share the `lab_test` database (created automatically with the MySQL volume; if your
volume predates it, see `mysql/init/01-test-db.sh`). Tests use Redis database 1; the app uses database 0.

## 3. API at a glance (`/api/v1`, errors are `{"detail": "...", "code": "SNAKE_CASE"}`, a few with extra fields such as `conflict`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login` (httpOnly cookie) · `POST /auth/logout` · `GET /auth/me` · `POST /auth/register` (public student sign-up, below) · `PATCH /auth/me` and `POST /auth/change-password` (every role: my own account, below) · `GET/PATCH /me` and `POST /me/change-password` (the same, every role) |
| Admin | `GET/POST /users` · `GET /users/counts` · `PATCH /users/{id}` · `POST /users/{id}/reset-password` · `POST /users/import` (CSV: `student_no,full_name,username,temp_password`) · registration codes: `POST/GET /registration-codes`, `GET /registration-codes/batches`, `DELETE /registration-codes/{id}`, `DELETE /registration-codes?batch=NAME` |
| Instructor | classes, invite codes, enrollments (approve/reject/remove), lab sessions (open/close), activities (publish), submissions, read-only student workspaces, `GET /sessions/{id}/monitor`, and the **automatic test cases**: `GET/POST /activities/{id}/test-cases` · `PATCH /activities/{id}/test-cases/order` · `PATCH/DELETE /test-cases/{id}` · `POST /test-cases/{id}/try` · `POST /activities/{id}/regrade` (below) |
| Student | `POST /enroll`, `GET /my/classes`, workspace tree/files/versions, `POST /workspace/{class_id}/run` (`mode`: interactive or batch, below), `GET /executions/{id}`, `POST /activities/{id}/submit`, `GET /classes/{class_id}/my-submissions` (my latest submission per activity: `[{activity_id, status, submitted_at}]`, approved students only, not paginated), `GET /activities/{id}/test-cases/student` (the test cases a student may see), `POST /workspace/{class_id}/test` (the **Test** button: run the activity's test cases), and the personal **Practice** workspace `/practice/*` (below; instructors have one too) |

### Workspace storage limits (admin)

An admin sets the limits per role (student, instructor), and per user when needed. They apply to **each** workspace
of a user (every class workspace and the Practice workspace). All sizes are in bytes. Built-in defaults: 100 KB per
file, 2 MB per workspace, 100 files.

* `GET /storage-limits` → `{student: {max_file_bytes, max_workspace_bytes, max_files, updated_at, updated_by},
  instructor: {...}, bounds: {max_file_bytes: {min, max}, ...}}` (`updated_at: null` = never changed).
* `PATCH /storage-limits/{student|instructor}` with any of the three fields. Bounds: 1 KB-1 MB per file, 10 KB-8 MB per
  workspace (every Run copies the whole workspace into the sandbox's 10 MB `/workspace`), 1-500 files (`422` outside;
  `null` is `422`). A file limit above the workspace limit is `400 INVALID_STORAGE_LIMITS`; another role is `404`.
* `GET /users/{id}/storage` → `{user_id, role, role_limits, override, effective, workspaces: [{workspace_id, class_id,
  class_name, files, bytes}]}` (the Practice workspace has `class_id: null`, listed last).
* `PUT /users/{id}/storage` `{max_file_bytes?, max_workspace_bytes?, max_files?}` sets the user's own limits; a field
  that is null or left out follows the role (`{}` = all from the role). Admins have no workspace (`400 NO_WORKSPACE`).
* Lowering a limit deletes nothing: a workspace already over it keeps its files; new files and saves that make it
  bigger are refused (`413 QUOTA_EXCEEDED` "Workspace storage limit (1.5 MB) reached", `413 FILE_TOO_LARGE` "File is
  larger than 50 KB", `400 TOO_MANY_FILES`), saves that make it smaller still work.
* The tree's `usage` (`max_bytes`, `max_file_bytes`, `max_files`) shows the limits that apply to that workspace's
  owner. Starter files of an activity may be as large as the students' file limit.
* **Clearing a workspace:** `POST /users/{id}/workspaces/{workspace_id}/clear` (ids from `GET /users/{id}/storage`)
  deletes every file and folder of that one workspace, with their saved versions. A class workspace then gets the
  starter files of the class's published activities back fresh (like a newly enrolled student's); Practice is left
  empty. Submissions are frozen copies and are not touched. Returns `{workspace_id, class_id, files_deleted,
  bytes_deleted, starter_files_restored}`; audited as `workspace_clear`. Cannot be undone. A student with a file open
  gets `404 FILE_NOT_FOUND` on the next save (nothing is announced to the class).

### One administrator

The system has **exactly one administrator account**, created by the first setup (`python -m app.seed`, as
`admin`, with a random password printed once).

* The users API never creates or produces another one: `POST /users` and `PATCH /users/{id}` with `role: "admin"`,
  and a CSV import whose optional `role` column says `admin` anywhere (the whole file), answer
  **`403 ADMIN_ROLE_RESERVED`**. No account's role can change at all (`400 ROLE_CHANGE_NOT_ALLOWED`); a CSV `role`
  other than `student` skips that row.
* The administrator account cannot be changed, deactivated, demoted or have its password reset through `/users`:
  **`409 ADMIN_PROTECTED`** ("The administrator account cannot be changed, deactivated or demoted here. The
  administrator changes its own name and password under My account."). No account can be deleted (there is no
  delete endpoint).
* `GET /users` lists instructors and students only (never the administrator); `?role=` accepts `instructor` or
  `student` (`admin` is `422`). `GET /users/counts` -> `{instructors, students}`.
* The administrator manages its own account like everyone else: **`GET /me`**, **`PATCH /me`** `{full_name}`
  (unknown fields are `422`) and **`POST /me/change-password`** `{current_password, new_password}` (the same rules as
  `/auth/change-password`, below). These work for every role, also while a temporary password must be changed.
* **Recovery** (lost admin password), on the server: `docker compose exec api python -m app.reset_admin` prints a new
  temporary password, sets `must_change_password`, re-enables the account and signs it out everywhere. The audit log
  records `admin_password_reset` (no user: it was done on the server; never the password).
* The database enforces it too: a generated column `users.admin_flag` (1 for the admin, NULL for everyone else) has a
  unique key, so MySQL itself refuses a second administrator. Migration 0019 stops with a clear message if a database
  already has more than one.

### My own account (admin, instructor and student)

* `PATCH /auth/me` `{full_name?, username?}`: send only what changes; returns the updated user (same shape as
  `GET /auth/me`). `full_name` is trimmed, 1-150 characters. `username` follows the sign-up rule (4-32 characters,
  `a-z 0-9 . _`, stored lowercase) and answers `409 USERNAME_TAKEN` if someone has it. The device stays signed in.
  `role`, `student_no`, `is_active` and any other field are **`422`**, never silently ignored (an admin changes the
  student number with `PATCH /users/{id}`). There is no email.
* `POST /auth/change-password` `{current_password, new_password}` -> `204`. `400 INVALID_CURRENT_PASSWORD`,
  `400 PASSWORD_UNCHANGED` (same as the current one), `422` for a new password outside 8-128 characters. On success every
  other session is signed out and this device receives a fresh cookie, so it stays signed in. Only **5 attempts per user
  per 15 minutes** are allowed (`429 TOO_MANY_ATTEMPTS`, counted in Redis, so a stolen cookie cannot guess the
  password; success resets the count), and Nginx adds 10 requests/minute per IP (burst 5).
* **Temporary passwords.** `must_change_password` (shown in `/auth/me` and the login response) is set when an admin
  resets a password (`POST /users/{id}/reset-password`) and for every account created by the CSV import. While it is
  `true` the user can sign in, but every endpoint (REST and WebSocket) except `GET/PATCH /auth/me`,
  `POST /auth/change-password` and `POST /auth/logout` answers **`403 PASSWORD_CHANGE_REQUIRED`**. Changing the
  password clears it, with no new login needed. Accounts created one by one with `POST /users` are not locked.
* **Preferences** (the Settings menu) follow the user to any computer. The user object returned by `POST /auth/login`,
  `POST /auth/register`, `GET /auth/me` and `PATCH /auth/me` carries `preferences`, always complete (defaults filled
  in, never `null`): `theme` `"dark"` (default) | `"light"` | `"system"` (follows the computer), and `editor_theme`
  `"match"` (default, same as `theme`) | `"dark"` | `"light"`. Change them with `PATCH /auth/me/preferences` and only
  the fields that change (`{"theme": "light"}`); the response is the full updated object. Unknown fields, unknown
  values and `null` are `422` and nothing is saved. Allowed while a temporary password must be changed. Kept apart
  from the profile (`PATCH /auth/me` still refuses unknown fields), and only ever for yourself: admins' user lists
  never include them. Stored as JSON on `users.preferences`; a new setting is a new field with a default in
  `app/schemas/preferences.py`, so older clients keep working, and a stored value that is no longer valid falls
  back to its default.
* The audit log records `profile_update` (the changed field **names** only), `password_change` and
  `password_change_failed` (user id and IP), never a password or a name.

### Student sign-up with registration codes

Students create their own account; an admin controls who may, with **one-time registration codes**. There is no email
anywhere: not in the database, the schemas or the endpoints.

1. **Admin generates codes:** `POST /registration-codes` `{count 1-200, batch_name, expires_at?, student_no?, full_name?}`
   returns the codes in plaintext **once** (`XXXXX-XXXXX`, 10 characters, no `0 O 1 I L`) and never again.
   `student_no` (the code only works for that student number) and `full_name` (becomes the account's name) are for
   single codes only. Hand the codes out on paper or in person.
2. **Student signs up:** `POST /auth/register` `{code, student_no, full_name, username, password}` (public). Username
   4-32 characters `a-z 0-9 . _` (stored lowercase), password at least 8, `student_no` and `full_name` required. The
   code may be typed in any case, with or without the hyphen. On success the student is signed in (same cookie and
   one-device rule as `/auth/login`) and the code is **deleted**.
3. **Failures.** A bad, used, revoked, expired or mismatched code is always `400 INVALID_REGISTRATION_CODE` with the
   same message ("Invalid or expired code"), so nothing hints which part was wrong. A taken username or student number
   is `409 USERNAME_TAKEN` / `STUDENT_NO_TAKEN`, and a failed sign-up **never consumes the code**. Using the same
   code twice at the same moment creates exactly one account (the code row is locked inside one transaction).
4. **Admin overview:** `GET /registration-codes?batch=&page=` lists unused, still-valid codes (id, last 4 characters,
   batch, student_no, expires_at, created_at; never the code), `GET /registration-codes/batches` gives batch names with
   counts, and codes are revoked one at a time (`DELETE /registration-codes/{id}`) or per batch
   (`DELETE /registration-codes?batch=NAME`). A daily beat job (03:00 UTC) deletes expired codes.

Only the SHA-256 of a code is stored, and codes are never logged or written to the audit log. The audit log records
codes generated (count, batch), codes revoked, successful sign-ups (user id, batch) and failed sign-ups (IP only).
Nginx limits `/auth/register` to 5 requests per minute per IP (burst 3): students signing up from the same shared
address (e.g. one NAT) may need to space themselves out.

### Python tutorial (built in, offline)

A W3Schools-style course of 25 lessons (print, comments, variables, data types, numbers, strings, input and casting,
booleans, if/elif/else, while, for and range, break and continue, lists, tuples, dictionaries, sets, functions,
parameters and return, scope, modules and import, try/except, files, f-strings and string methods, classes, and a bonus
linear search), each with 1-3 runnable examples and one exercise checked by 2 sample + 2 hidden tests. It reuses the
editor, the sandbox, interactive input and the test-case engine of the activities.

**Content.** The lessons live in the repo as `content/tutorial/NN-slug.md`: a YAML front matter (`title`, `order`,
`summary`, `examples`, `exercise` with `prompt`, `starter_code`, `starter_files` for multi-file lessons, `entry`,
`ignore_input_prompts`, `tests`, `reference_solution`) and the lesson text in Markdown. `python -m app.tutorial_content`
(also run by `python -m app.seed`, and `POST /tutorial/manage/lessons/seed` for admins) loads or updates them into
`tutorial_lessons`, keyed by slug, overwriting edits but keeping `is_hidden`. `tests/test_tutorial_content.py` runs
every lesson's reference solution through the real sandbox and asserts it passes ALL its tests, that the starter code
does not, and that every example runs; a lesson with broken tests cannot ship.

| Who | Call | What |
|---|---|---|
| Student (anyone signed in) | `GET /tutorial/lessons` | Visible lessons in order: `{slug, title, order, summary, passed, viewed, attempts, locked}` |
| Student | `GET /tutorial/lessons/{slug}` | `body_md`, `examples`, `exercise` (prompt, starter code/files, entry; sample tests in full, hidden tests as `{name, is_hidden: true, points}` only), `progress` (with `last_code`). `403 TUTORIAL_LOCKED` when locked |
| Student | `POST /tutorial/lessons/{slug}/view`, `PUT /tutorial/lessons/{slug}/code` `{code}` | First view; autosave of the exercise code (100 KB) |
| Student, instructor | `POST /tutorial/run` `{code, stdin?, mode}` -> 202 | Runs `code` as `main.py` on the practice queue (batch) or the interactive queue, **never blocked by lab sessions**; same per-student limits as any run; follow it on `/ws/run/{id}` |
| Student | `POST /tutorial/lessons/{slug}/check` `{files: [{path, content}]}` -> 202 | A test job (same engine as activities, practice queue): `GET /executions/{id}` has `kind: "test"`, `tutorial_lesson_id`, `test_results` (hidden outputs redacted) and `test_summary`. Every check counts an attempt; the first all-pass sets `passed_at` |
| Instructor | `GET /classes/{id}/tutorial-progress` | Student x lesson matrix: `passed_at`, `attempts`, `last_activity`, `passed_count` |
| Instructor | `PATCH /classes/{id}` `{tutorial_unlock_in_order}` | Lessons open one at a time for this class's students (a lesson is locked until the previous visible one is passed; the first is never locked). A student in ANY class with the flag is locked |
| Admin, instructor | `GET /tutorial/manage/lessons`, `GET /tutorial/manage/lessons/{slug}` | Everything, hidden lessons, hidden tests and reference solutions included |
| Admin, instructor | `POST /tutorial/manage/lessons`, `PATCH /tutorial/manage/lessons/{slug}`, `PATCH /tutorial/manage/lessons/order` `{order: [slugs]}`, `POST /tutorial/manage/lessons/{slug}/reset` | Create; edit text, examples, exercise and tests, hide/show (`is_hidden`); reorder; reset to the repo file (`404 NO_DEFAULT` for a lesson created by hand) |
| Admin, instructor | `DELETE /tutorial/manage/lessons/{slug}` -> 204 | Only a lesson created by hand (`has_default: false`); a default one is `409 LESSON_IS_DEFAULT` (hide it instead, or the next load would bring it back). Students' progress on it is deleted; executions keep their row, unlinked. Locks follow the remaining lessons at once |

Hidden tests' input and expected output and the reference solution are never in any student response; a locked or
hidden lesson cannot be viewed, saved, checked or marked viewed. The exercise's tests are stored in the lesson's JSON,
not in `test_cases`; their ids in `test_results` are the test's position (1, 2, ...).

### Labs, bookings and the sign-in log

**The real client IP** (for the audit log and the rate limits; no feature reads it). Nginx overwrites `X-Real-IP` and
`X-Forwarded-For` with `$remote_addr`, and the api believes those headers only when the TCP peer is Nginx itself: Nginx
has a fixed address on the compose network (`172.28.0.10`, subnet `172.28.0.0/24`; `TRUSTED_PROXY_IPS` and
uvicorn/gunicorn `forwarded_allow_ips`). A header sent by anyone else is ignored. If that subnet clashes with your LAN,
change it in `docker-compose.yml`, `.env` (`TRUSTED_PROXY_IPS`) and the api command together.

**Labs** are named rooms (admins and instructors): `GET/POST /labs`, `GET/PATCH/DELETE /labs/{id}`, body `{name}`
(`409 LAB_NAME_TAKEN` for a name in use). Answers are `{id, name}`. Deleting a lab that still has sessions that have
not ended is refused with `409 LAB_HAS_SESSIONS` (`sessions`: how many); ended sessions keep their history with
`lab_id: null`.

**Sessions:** a session is one meeting of a class, `name` e.g. "Week 3". `lab_id` (the room) is required:
`POST /classes/{id}/sessions` without it is `422`. `PATCH /sessions/{id}` `{lab_id}` moves a session to another lab
(together with `name`, `starts_at`, `ends_at` if wanted), but cannot remove it (`lab_id: null` is `422`). Opening a
session without a lab (one whose lab was deleted after it ended, then moved later) is `409 LAB_REQUIRED`.

**Lab bookings.** A session books its lab from `starts_at` to `ends_at`, across all instructors.
`GET /labs/{id}/schedule?from=&to=` (admins and instructors) lists the sessions booking it that have not ended: running
ones first, then upcoming by `starts_at`; `from`/`to` (ISO) keep only those overlapping that window. Each item:
`{session_id, name, starts_at, ends_at, is_open, class: {id, name, year_and_section}, instructor: {id, full_name},
mine}` (`is_open` = running: open and before `ends_at`; `mine` = a session of the viewer's own class).

* An overlapping booking of the same lab is refused with **`409 LAB_BOOKED`** ("Lab A is booked Mar 4, 10:00–11:00 AM
  by Prof. Elena Marquez (CC 101, Week 3)", times in school time), from `POST /classes/{id}/sessions` and from
  `PATCH /sessions/{id}` with another `lab_id` or new times. The body also has `conflict`: the other session, shaped
  like a schedule item. Back-to-back (one ends exactly when the next starts) is not an overlap.
* Opening a session (or moving a running one to another lab) while another running session uses its lab:
  **`409 LAB_IN_USE`** ("Lab A is in use until 11:00 AM by ..."), with `conflict` too.
* Only sessions that have not ended book a room; sessions of archived classes book nothing (they can never be opened
  again). A session closed early keeps its booking, since it can be reopened until its `ends_at`: move its end time to
  free the room. The checks hold a row lock on the lab, so two instructors booking the same slot at once cannot both
  get it.

**Sign-in log:** every sign-in writes a `login_events` row: the user, the lab session (a student whose class has one
open), the browser's user agent, and the `outcome`: `success`, or `replaced_other_session` when it signed another
session of the account out (one active session per account: that device gets `401 SESSION_REPLACED`). No address or
device is stored there; the audit log keeps the address of each login as ordinary security logging.
`GET /sessions/{id}/logins?page=&size=&since=` (the class's instructor) lists the session's sign-ins newest first:
`{id, at, student: {id, username, full_name, student_no}, outcome}`. `since` is an ISO time (an offset is converted to
UTC, without one it is taken as UTC); only newer sign-ins are returned.

### Activity rules in a student's workspace

* **Starter files are protected.** The activity folder, every starter file (`{title}/{path}`) and every folder that
  holds starter files can be **edited** (files) but not deleted, renamed or moved: `403 STARTER_FILE_PROTECTED`
  ("main.py is a starter file of 'Lab 1': it can be edited but not deleted, renamed or moved"). Files and folders
  the student creates inside the activity folder are fully theirs, and moving them into or out of the folder is
  allowed while the activity is open.
* **At `due_at` the activity folder becomes read-only**, like an archived one: saving, creating, renaming, moving in or
  out and deleting answer `403 ACTIVITY_PAST_DUE` ("'Lab 1' was due on Oct 14, 10:00 AM: its folder is read-only";
  times are shown at `DISPLAY_UTC_OFFSET_HOURS`, default +8). Reading, Run and Test keep working. No due date, no lock.
  The "lab must be open" rule still applies before the due date (`LAB_CLOSED` comes first).
* **No late submissions:** `POST /activities/{id}/submit` from `due_at` on is `403 ACTIVITY_PAST_DUE`, so new
  submissions are always `submitted` (older rows marked `late` stay as they are). A later `due_at` (or none) set with
  `PATCH /activities/{id}` unlocks the folder and Submit at once.
* **Nothing at the top level but activity folders.** In a class workspace (not Practice), creating a file or folder
  outside a published activity's folder, or renaming / moving an entry so that it ends up outside one (at the top level
  or in another top-level folder), is `403 OUTSIDE_ACTIVITY_FOLDER` ("Files and folders go inside an activity
  folder."). The activity folders themselves are made by the server. Older top-level entries may stay, be edited,
  deleted, or moved into an activity folder. (In the tests this rule is off unless a test is marked
  `@pytest.mark.top_level_rule`, because most tests exercise other mechanics with top-level paths.)
* **The tree says it in advance:** every entry of `GET /workspace/{class_id}/tree` (and the save / rename responses)
  has `protected` (bool) and `read_only_reason` (the same text the 403 would give, or `null`), covering past due and
  archived folders. Practice workspaces have no rules (always `false` / `null`).

### Deleting and archiving activities

* `DELETE /activities/{id}` (the class's instructor) -> `204`, **drafts only**: their test cases go too, executions keep
  their row with `activity_id: null`. A published activity is `409 ACTIVITY_PUBLISHED` ("Published activities can be
  archived, not deleted").
* `PATCH /activities/{id}` `{is_archived: true|false}` (published activities only, else `400 ACTIVITY_NOT_PUBLISHED`);
  `ActivityOut` has `is_archived`. An archived activity is gone from the students' view: left out of their activity
  list, and its page, test cases, Test button and Submit answer `404 ACTIVITY_NOT_FOUND`. Its folder stays in their
  workspaces, **read-only**: saving, creating, renaming, moving in or out and deleting answer `403 ACTIVITY_ARCHIVED`
  (reading and running still work). Submissions and grades are kept; students still see their own submission, and the
  instructor sees everything. `GET /classes/{id}/activities` leaves archived ones out unless `?include_archived=true`
  (instructor only). Unarchiving restores it all and gives students who joined meanwhile the activity's folder.
  Both actions are in the audit log (`activity_delete`, `activity_archive`).

### Automatic grading (test cases)

An activity can have up to **20 test cases**: a name, `stdin`, `expected_output` (each at most 20 KB), `points` (>= 0,
default 1), `is_hidden`, a `match_mode`, `require_input_read` (default `true`, below) and an order. Instructors manage them at any time, even after publishing.
Two options live on the activity itself (`POST/PATCH` activity): `entry_file` (the program that is run, relative to the
activity folder, default `main.py`) and `ignore_input_prompts` (default `true`).

| Who | Call | What it does |
|---|---|---|
| Instructor | `POST /activities/{id}/test-cases` `{name, stdin, expected_output, is_hidden, points, match_mode, require_input_read}` | Adds a case (`400 TOO_MANY_TEST_CASES` after 20, `413 TEST_CASE_TOO_LARGE`, `400 EMPTY_EXPECTED_OUTPUT` for `contains` without text). `PATCH /test-cases/{id}` changes any field, `DELETE` removes it, `PATCH /activities/{id}/test-cases/order` `{order: [ids]}` reorders (every id exactly once). |
| Instructor | `POST /test-cases/{id}/try` `{files?}` -> 202 `{execution_id}` | Runs ONE case against the activity's starter files (or the given `files`, relative to the activity folder) so you can check the expected output. Read it at `GET /executions/{id}` (full output, it is your own run) or on `/ws/run/{id}`. |
| Instructor | `POST /activities/{id}/regrade` -> `{queued, skipped}` | Grades every submission again (use it after fixing an expected output). A submission whose grading is already waiting is skipped. |
| Student | `GET /activities/{id}/test-cases/student` | Visible cases with `stdin`, `expected_output`, `points`, `match_mode`. A hidden case is only `{id, name, points, is_hidden: true}`. |
| Student | `POST /workspace/{class_id}/test` `{activity_id, entry_path}` -> 202 `{execution_id, queue_position}` | The **Test** button: runs all cases against the student's own files. Same guards as Run (lab open, one active job, 3 s between jobs, queue cap). The result is `GET /executions/{id}` (`kind: "test"`, `test_results`, `test_summary`). |
| Student | `POST /activities/{id}/submit` | Also queues a grading job on the **frozen submission snapshot** (entry = `<activity folder>/<entry_file>`). The submission gets `tests_passed`, `tests_total`, `score`, `max_score`, `graded_at` (all `null` until graded, and cleared again on resubmit), and for the instructor `hardcode_suspected` / `hardcode_tests` (below). |
| Instructor | `GET/PUT/DELETE /activities/{id}/requirements` | The activity's code requirements (below). The activity itself shows them as `requirements` (`null` = none), to its students too. |

**Match modes** (`trim` is the default): `trim` = `\r\n` becomes `\n`, trailing spaces on every line and trailing blank
lines are dropped, then compared; `exact` = `\r\n` becomes `\n` and ONE final line break is ignored on each side (so `print("Hello World")` matches the
expected text `Hello World`), then compared byte for byte: spaces, capitals and extra blank lines still count; `ignore_case` = `trim`, then case-insensitive; `contains` =
`trim`, then the expected text must appear inside the output. A case passes only if the program also **finished
normally** (exit code 0, no timeout): points are all-or-nothing per case. With `ignore_input_prompts` on, the text a
program passes to `input("...")` is not printed into the output being compared (an `EOFError` is raised when the input
runs out, as usual).

**Statuses per case:** `ok`, `error` (crashed), `timeout` (5 s per case), `memory_exceeded`, `output_limit` (16 KB per
case), `input_not_read` and `requirement_failed` (below). One failing or hanging case never stops the others.
`test_results` holds, per case: `case_id`, `name`, `is_hidden`, `passed`, `points`, `points_awarded`, `status`,
`duration_ms`, `actual_output` (cut at 4 KB), `message` (the explanation of `input_not_read` / `requirement_failed`,
else `null`), `lines_given`, `lines_read`. **Students get `actual_output: null` for hidden cases**, here and everywhere
else.

**Against hardcoded answers.**

* **The program must read its input** (`require_input_read`, on by default for every case, existing ones included).
  A case with `stdin` passes only if the output matches AND the program read every input line up to the last
  non-blank one. Otherwise its status is **`input_not_read`**, with the message "Your program did not read all the
  input (read 1 of 2 values)." A program that prints the right answer without calling `input()` therefore fails.
  The counting happens in `boot.py`, outside the student's process: a case's stdin goes into the program's pipe one
  line at a time, and the next line is written only when the pipe is empty again. `input()`, `readline()`, `read()`,
  iterating `sys.stdin` and `os.read` all have to take lines from that pipe, so the count is exact and the program
  cannot change it. A line taken only partly (e.g. `os.read(0, 1)`) does not count. The counts are reported only
  inside the nonce-framed block. Cases without `stdin`, and cases with `require_input_read: false`, are not checked.
  Tutorial exercises are not checked either.
* **Code requirements** (optional, per activity): `PUT /activities/{id}/requirements` `{must_define_functions:
  ["average"], must_use: ["for" | "while" | "if" | "def" | "class"], must_not_use_calls: [".index", "sorted"],
  must_not_use_imports: ["statistics"]}` (empty lists = none; `DELETE` clears them). `.name` forbids a method call
  (`anything.name(...)`), `name` a call of that function; an import also covers its submodules; `for` is met by a loop
  or a comprehension, `if` by an `if` statement or a conditional expression. They are checked with `ast` on the `.py`
  files of the activity folder before anything runs (Test, grading and an instructor's try). If any is not met,
  **every case fails** with status **`requirement_failed`** and a message listing what is missing ("Your code does not
  meet the activity's requirements: Define a function named average(). Do not use .index()."), and the sandbox is
  not used. Code that is not valid Python is not checked (the run itself shows the error). A change applies from the
  next Test or grading; use Regrade for existing submissions.
* **Hardcoding flag** (no automatic fail): when a submission is graded, every expected-output line of a **hidden**
  case that is at least 6 characters and not just a number is looked for inside the string literals of the
  submission's `.py` files (`ast` string constants, including multi-line strings). A match sets
  `hardcode_suspected: true` and `hardcode_tests: ["case name", ...]` on the submission. Lines the activity itself
  gives away (its instructions, or string literals of its starter files) never count. Only the class's instructor
  sees the flag (submission list and detail); the student gets `null`. A resubmission clears it until it is graded
  again.

**How the answer can't be faked.** The sandbox receives the student's files plus, for each case, only its `id` and `stdin`:
**expected outputs never leave the database** and are compared by the worker. The worker gives the container a random
per-job nonce that only `boot.py` (the container's PID 1 child) holds; `boot.py` runs the program once per case through
pipes and finally prints ONE JSON block framed by that nonce. The worker trusts only that block, so a program that
prints a perfect-looking fake result (or writes into the container log) gets nothing. `boot.py` also makes itself
undumpable (`prctl`), so the student's program cannot read the nonce from `/proc`. Each case starts from a freshly
written `/workspace`. All container limits (memory, CPU, pids, read-only, no network, ...) are unchanged; the
whole-container timeout of a test job is `min(5 s x cases + 5 s, 60 s)`. Known and harmless: a program can still write
text into the container's log through `/proc/1/fd/1`, which is ignored for the reason above.

**Realtime.** On `/ws/run/{execution_id}` a test job sends `{"type":"status"}`, one `{"type":"test_result", case_id,
passed, status, duration_ms}` per case (never any output), then `{"type":"done", kind:"test", status, passed, total,
score, max_score}`. The results arrive together when the container finishes (`boot.py` reports once, at the end), and a
socket opened afterwards gets the same messages replayed. The monitor feed gets `{"type":"tested", execution_id, activity_id, passed, total, score, max_score}` when
a student presses Test, and `GET /sessions/{id}/monitor` returns each student's `last_test`: `{execution_id, activity_id,
passed, total, score, max_score, finished_at}` for their most recent **finished** Test in that session (`null` if none;
a Test still waiting or running is skipped until it completes, and one that could not run has no result). Because a
Test now has its own field, `last_run` is the most recent plain **Run** only.

Notes: grading jobs are system-initiated, so they do not count as the student's active run and ignore the per-student
limits (they go through the same queue); if queueing one fails, the submit still succeeds and the score stays empty
until you regrade. If the container itself fails (Docker down), the job ends as `system_error` and the submission is
left ungraded rather than scored 0. **After pulling this feature rebuild the runner image** (`boot.py` changed):
`docker build -t lab-python-runner:1 sandbox-image/`, then `docker compose restart worker practice-worker interactive-worker`.

### Interactive input (programs that pause at `input()`)

`POST /workspace/{class_id}/run` and `POST /practice/run` accept `mode`: **`"interactive"` (the default)** or
`"batch"`. In interactive mode the program stops at every `input()`, the student types the value live, and the run
goes on; `stdin` is ignored. In batch mode all input is given up front in `stdin`, exactly as before. Test cases,
**Test** and grading are always batch.

Over `/ws/run/{execution_id}` (open it right after the `202`):

| Direction | Message |
|---|---|
| server -> client | `{"type":"status"}`, `{"type":"output","data"}`, `{"type":"input_request"}` (the program is waiting: show an input box), `{"type":"done","status","exit_code","duration_ms"}` |
| client -> server | `{"type":"stdin","data":"one line"}` · `{"type":"eof"}` (closes stdin: `input()` raises `EOFError`) · `{"type":"stop"}` (kills the program) |

* The prompt arrives as output, and **the typed line is echoed back as output** right after it (a pipe has no
  terminal), so the frontend must not echo it itself. The stored `output` equals what was streamed.
* Only the run's owner can send messages (anyone else gets `EXECUTION_NOT_FOUND`). A line is at most 1,000 characters
  with no line break inside, and a run takes at most 200 inputs; a bad message gets `{"type":"error","code":
  "INPUT_TOO_LONG" | "INVALID_INPUT" | "INVALID_MESSAGE" | "UNKNOWN_MESSAGE" | "INPUT_LIMIT"}` and the socket stays open.
  Messages to a batch run are ignored. A Stop sent while the run is still queued is remembered, so the program never starts.
* `executions.stdin` holds every typed line joined with `\n` (`GET /executions/{id}` returns it, with `mode`), so the
  frontend can offer **Run again with the same inputs** by sending `mode: "batch"` and that `stdin`.
* New final statuses: **`stopped`** (Stop pressed) and **`input_timeout`** (no input for 120 s, the output ends with
  "No input received").
* **Limits.** Every sandbox limit is unchanged (128 MB, no swap, 0.5 CPU, 64 pids, read-only, no network, 64 KB of
  output, ...) except that the 10 s *wall clock* becomes **10 s of CPU time** (`RLIMIT_CPU`, a program that spins is
  stopped with status `timeout`; time spent waiting for the student is free), plus **120 s to answer one input** and
  **5 minutes** for the whole run.
* **How.** `boot.py` reads exactly the payload from stdin and starts the program through a wrapper that replaces
  `input()`: it prints the prompt, then a marker line with a random per-run nonce, then reads one line. The worker keeps
  the container's stdin attach socket open, removes the marker from the stream, publishes `input_request`, and writes
  the lines that arrive on Redis `exec_in:{id}` (the api relays the WebSocket's messages there). A program that prints
  the marker itself (it can find the nonce in its own command line) only causes a harmless `input_request`; any output
  after the marker shows it was not waiting, so it is never timed out for that.
* **Capacity.** Interactive runs (lab and practice) go to the Celery queue **`interactive`**, served by the
  `interactive-worker` service with `--pool=threads` and `INTERACTIVE_CONCURRENCY` (default 40) runs open at once, so
  runs waiting for a student never occupy the batch workers (measured in `tests/test_interactive_e2e.py`: a batch run
  took the same time while 20 interactive runs sat waiting). The per-student rule is unchanged: **one active run**,
  batch or interactive, and a 3 s gap between runs. `503 SERVER_BUSY` when more than 150 interactive runs are waiting.
  Practice and lab interactive runs share this queue and its slots.

### Practice workspace (`/practice/*`, students and instructors)

A personal workspace per student **and per instructor** that is **not tied to any class**, for experimenting outside
labs (an instructor can use it for sample solutions or answer keys). Admins have none (`403`). It is created on
first access and mirrors the class workspace endpoints, with the same path rules, extensions and quotas:
`GET /practice/tree` · `POST /practice/files` · `GET|PUT|PATCH|DELETE /practice/files/{id}` ·
`GET /practice/files/{id}/versions` · `GET /practice/versions/{id}` · `POST /practice/run` (poll `GET /executions/{id}`
or stream `/ws/run/{id}`; an execution has `practice: true` and `class_id: null`).

* **Never locked by lab sessions**, and needs no enrolment: it works with the lab closed or no lab at all.
* **Private to its owner; no submit, no monitor events.** Practice files are never part of a submission. A student's
  Practice workspace is invisible to instructors (their read-only views, the monitor feed and the monitor snapshot do
  not include it), and an instructor's is invisible to students and to other instructors: another user's file id is `404`.
* **Separate capacity.** Practice runs go to their own Celery queue (`practice`), served by `practice-worker`, which
  runs `PRACTICE_CONCURRENCY` (default 2) runs at a time, so a flood of practice runs cannot slow a lab (measured: a
  lab run took 0.6 s while 12 practice runs were queued). Same sandbox and limits.
* **The per-student run limits are shared with lab runs:** one active run per student at a time and one run per 3 s,
  whether practice or lab. Practice answers `503 SERVER_BUSY` when more than 50 practice runs are waiting.
* Files of the two kinds never mix: a practice file id is `404` on `/workspace/*` and a class file id is `404` on
  `/practice/*`.

**When students start.** The first time a student reaches their class workspace (`GET /workspace/{class_id}/tree`,
or a file opened) while the class has an OPEN lab session, `session_starts` records `started_at` for that session and
student; the first time they open a file inside an activity's folder, `session_activity_starts` records that
activity's start (and the session start's `first_activity_id`, if not set yet). Both are written once (a unique key and
`INSERT IGNORE`): reloads change nothing, a closed session records nothing, each session has its own rows. The client
sends no session id: the server finds the open session. Instructors viewing a student's workspace and Practice record
nothing. `GET /sessions/{id}/monitor` gives each student `started_at`, `first_activity_id` and `activity_starts:
[{activity_id, title, started_at}]` (oldest first); the monitor feed gets `{"type":"started", student_id, student,
ts, started_at}` and, per activity, the same plus `activity_id`, `activity` (title). A recording failure is logged and
never breaks the student's request.

**Lab sessions follow their schedule** (Celery beat, every 15 s; events and audit rows have no user):

* **They open themselves at `starts_at`** (event `session_opened` with `"reason": "scheduled_start"`), but only a
  session that was never opened: one the instructor opened and closed again stays closed. It waits (and is tried again
  every 15 s) while its class has another session open or its lab is in use; a session without a lab never opens itself.
* **They close themselves at `ends_at`** (`session_closed`, `"reason": "scheduled_end"`). From that moment the lab
  already counts as closed, even before the sweep runs, so writes stop on time.
* **Opening by hand** works from 15 minutes before `starts_at`. Earlier: `409 SESSION_NOT_STARTED` ("Week 11 starts
  Oct 19, 8:00 AM: it can be opened from 7:45 AM.", plus `opens_at`). A session opened early uses its lab from that
  moment (`LAB_IN_USE` for the others).
* **A session open more than 15 minutes before its start** (opened before this rule, or moved later while open) is
  closed and put back to "not opened yet" (`opened_at`/`closed_at` cleared; `session_closed`, `"reason":
  "before_start"`), so it still opens itself at its start.

The instructor can still close by hand at any time. An ended session cannot be reopened (`409 SESSION_ENDED`): extend
it first with `PATCH /sessions/{id}` `{ends_at}` (also `name`, `starts_at`).

Key rules: one device per account (a second login signs the first out with `SESSION_REPLACED`); workspace writes and
Run return `403 LAB_CLOSED` while no lab session is open (reading and submitting still work); 100 KB/file, 2 MB,
100 files per workspace by default (an admin can change them, see "Workspace storage limits") and 100 folders; saves are optimistic-locked with `last_updated_at` (`409 SAVE_CONFLICT`);
Run allows one run at a time per student and one every 3 s (`429`), and answers `503 SERVER_BUSY` when more than
150 jobs are waiting.

### WebSockets (same cookie as the REST API)

Close codes: `4401` not signed in / signed in elsewhere · `4403` not allowed · `4404` not found · `4408` idle.
Before closing for an error the server sends `{"type":"error","code":"...","detail":"..."}`.

| Socket | Who | Messages from the server |
|---|---|---|
| `/ws/run/{execution_id}` | the student who started the run (or the instructor who started a test-case "try") | `{"type":"status"}`, `{"type":"output","data":"..."}`, `{"type":"input_request"}` (interactive runs, which also accept `stdin` / `eof` / `stop` from the client: see Interactive input), `{"type":"done","status","exit_code","duration_ms"}`. A run that already finished is replayed immediately. If `done` carries an `output` field it is the complete output: use it. Test jobs send `test_result` messages and a `done` with `kind:"test"` and the totals (see Automatic grading). |
| `/ws/class/{class_id}` | approved students and the class's instructor | `session_opened`, `session_closed`, `activity_published`. **Students must send any text (e.g. `{"type":"ping"}`) at least every 30 s**: it is their presence heartbeat, answered with `{"type":"pong"}`. |
| `/ws/monitor/{lab_session_id}` | the instructor who owns the session | `run`, `run_done`, `tested`, `saved`, `submitted`, `online`, `offline`, `started` (with `student_id`, `student`, `ts`; never student code). Pair with `GET /sessions/{id}/monitor` for the full picture. |

Open sockets re-check their user every 20 s, so signing in on another PC or being removed from a class closes them.

## 4. Production / LAN server

Target: Ubuntu Server 22.04+, 8 cores, 16 GB RAM, a **static IP**, only **port 80** open to the LAN.

```bash
# once: Docker Engine + compose plugin, then
git clone https://github.com/0jieE/pycode.git && cd pycode/backend
cp .env.example .env && nano .env         # ENV=prod, real passwords, SECRET_KEY, NGINX_PORT=80, COOKIE_SECURE=false (plain HTTP on the LAN)
docker build -t lab-python-runner:1 sandbox-image/
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose exec api python -m app.seed      # first install only: the one admin (password printed once) + samples
docker compose exec api python -m app.reset_admin   # only if the admin password is ever lost
```

`docker-compose.prod.yml` swaps the dev server for gunicorn (4 uvicorn workers), runs migrations on start and takes
the code from the image (no bind mount). Everything has `restart: always`, so it comes back after a reboot; MySQL
and Redis data live in named volumes (`docker volume ls`). Back up MySQL with
`docker compose exec mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" lab' > backup.sql`.

Notes: use `ufw allow 80/tcp` (and SSH) and nothing else; give the server a DHCP reservation or static address so the
lab PCs always find it; logs are JSON on stdout (`docker compose logs -f api worker`); set `ACCESS_LOG=true` in
`.env` to log every request. The sandbox needs no network: containers have none. Practice runs use a second, small worker
(`PRACTICE_CONCURRENCY` in `.env`); raise it only if the server has CPU to spare during labs. Nginx rate-limits Run (2 req/s per
IP, burst 5) and login (10 req/s).

### Windows server (Docker Desktop): real client addresses (optional)

Docker Desktop shows every client to the containers as one address (its gateway, `172.28.0.1`). So on Windows the
audit log records that one address for everybody, and the per-address rate limits (Run, login) are shared by the whole
lab. Nothing else depends on addresses. To get each PC's real address, put a small **Nginx for Windows** in front:

```
lab PC ──► Nginx for Windows :80 (sees the real address) ──► Docker Nginx 127.0.0.1:8080 ──► api
```

Once, on the server, in PowerShell **as Administrator**, from the backend folder:

```powershell
docker compose -f docker-compose.yml -f docker-compose.windows.yml up -d        # FIRST: Docker Nginx moves to 127.0.0.1:8080, freeing port 80
powershell -ExecutionPolicy Bypass -File deploy\windows\install-nginx.ps1    # THEN: Nginx in C:\lab-nginx, firewall, start at boot
```

For production, use `-f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.windows.yml`. Set the lab
network's profile to **Private** in Windows: the firewall rule covers Private and Domain networks only.

* **No faking.** `deploy/windows/nginx.conf` overwrites `X-Real-IP` and `X-Forwarded-For` with the real client
  address, so a PC can't write another address into the logs. WebSockets and long-running streams go straight through.
* **Docker's Nginx is closed to the LAN.** In this mode it listens on `127.0.0.1:8080` only, so lab PCs can't reach it
  directly. It believes `X-Real-IP` only from the Docker gateway, which means only from the Windows machine itself
  (`nginx/realip-windows.conf`).
* **Plain development mode is unchanged.** `docker compose up -d` trusts no header.
* **To remove it**, run `deploy\windows\uninstall-nginx.ps1`, then start Docker without the Windows file to use port 80
  directly again.
* **Capacity:** Nginx for Windows handles up to about 1,000 connections, plenty for a lab of a few dozen PCs.

## 5. Load test

Simulates a full lab: 120 students, each autosaving every 5 s and pressing Run every 30 s, plus a spike where
**all 120 press Run at the same instant**. Targets: steady-state run turnaround p95 ≤ 3 s, the 120-run spike drained
in ≤ 20 s, 0 errors. The test exits non-zero when a target is missed.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build      # test the production setup
docker compose exec api python -m loadtest.prepare_loadtest --students 120           # creates load001..load120 (+ a class)
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm --no-deps -T api \
    locust -f loadtest/locustfile.py --headless -u 120 -r 20 -t 3m --host http://api:8000
```

It talks to the api directly, bypassing Nginx: from one machine every request would share one IP and trip the
per-IP Run limit that real lab PCs (one IP each) never reach. Load-test accounts stay in the database (`docker compose
down -v` wipes everything). Environment knobs: `SPIKE_AFTER_SECONDS`, `SAVE_EVERY_SECONDS`, `RUN_EVERY_SECONDS`,
`LOAD_STUDENTS` (pass them with `-e NAME=value` after `run`).

**Choosing `CELERY_CONCURRENCY`** (parallel sandbox runs). Measure what Docker on *your* server can do:

```bash
docker compose exec worker python -m loadtest.bench_sandbox --sweep --runs 60
```

and pick the smallest value after which runs/s stops improving.

### Results on the development PC (Docker Desktop, 16 logical CPUs but only 8 GB RAM in the Docker VM)

| | |
|---|---|
| API under 120 users | **0 errors.** autosave p50 52 ms / p95 220 ms · run request p95 ≈ 2 s during the spike · polling p95 ≈ 170 ms |
| Run turnaround, steady state | p50 1.5–3.8 s; **p95 18–27 s (target 3 s): not met** |
| 120-run spike | all 120 ok; drained in **28 s with 12 workers** (44 s with 8) (target 20 s): **not met** |
| Sandbox alone, no other load | 4.2 runs/s at 4 workers → 7.3 runs/s at 12 workers (1.2–1.5 s per run) |

What this means: the application tier is fast and error-free, but run throughput is bound by how quickly Docker can
create, start and delete containers. On a freshly started, idle Docker the sandbox alone peaks at about **6.4 runs/s**
(10 workers; 12 gives the same, 8 gives 5.2), and the 120-run spike needs ≥ 6 runs/s, so there is no headroom even
in the best case. Under the full test the numbers got worse (spike drained in 28–44 s), and the cause was found:

* **The Docker daemon's own memory.** While the test ran, `dockerd` grew to **5 GB RSS** (it idles at 1–2 GB), the
  8 GB Docker VM ran out of free RAM and started swapping (load average 20–35), and the daemon stalled for 10+ s
  (even `docker ping`). Runs that hit Celery's 12 s limit are reported as `system_error`. This is not a leak in the
  sandbox code: a plain create/start/remove loop with no attach or log streams makes `dockerd` swing by hundreds of
  MB per 100 runs in the same way (the Go garbage collector, not a steady climb).
* A nearly full disk on the development PC (300 MB free) probably made this worse, but re-running with 64 GB free
  did not fix it: memory was the limit.

**Before the first lab, repeat the load test on the real server** (Ubuntu, 16 GB RAM, native Docker). Budget RAM
for `dockerd` (up to ~5 GB under a 120-run spike) on top of MySQL, the api and the worker. Two things to try there if
it still falls short: cap the daemon's heap with a systemd drop-in (`sudo systemctl edit docker`, then add
`[Service]` / `Environment="GOMEMLIMIT=2GiB"`, and `sudo systemctl restart docker`; untested here, since Docker
Desktop does not allow it), and stagger the students' Run clicks. On this PC, giving WSL2 more memory
(`memory=` in `%UserProfile%\.wslconfig`, then `wsl --shutdown`) is the equivalent.

Problems this load test uncovered and that are fixed: MySQL deadlocks between the stale-run cleanup and the workers
(cleanup now updates by primary key; workers retry a deadlocked status update), dropped connections from an idle
keep-alive timeout shorter than the autosave interval, a race in the orphan-container reaper, and Nginx keeping a
stale address after the api container was recreated.

### Recommendations before the first real lab

1. **Run the load test on the actual lab server** (Ubuntu installed directly on the machine, 8 cores, 16 GB RAM).
   The numbers above come from Docker Desktop on a development PC and are not a verdict on the target hardware.
   Use `python -m loadtest.bench_sandbox --sweep` to choose `CELERY_CONCURRENCY`, then run the Locust test.
2. **A VirtualBox Ubuntu is good for rehearsing, not for measuring.** It runs the same Docker Engine, so it is a fair
   test of the install steps, the `docker-compose.prod.yml` start-up, LAN access (use *Bridged Adapter* and a static
   IP) and the `GOMEMLIMIT` setting. It is still a virtual machine sharing the PC's RAM and disk, so treat its
   load-test numbers as a floor. Give it at least 4 CPUs, 8 GB RAM and a 40 GB disk.
3. **Budget RAM for the Docker daemon.** `dockerd` can use up to ~5 GB while 120 runs are in flight. With MySQL, the
   api and the worker, plan for 16 GB total; consider `GOMEMLIMIT=2GiB` for `docker.service` (section above).
4. **Keep the server's disk and memory healthy.** A nearly full disk makes Docker stall (seen during development).
   Keep at least 10 GB free, and prune old images occasionally (`docker image prune`).
5. **If the targets are still missed on the real server**, the options are more RAM for Docker, a higher
   `CELERY_CONCURRENCY`, or staggering the students' Run clicks. `innodb-buffer-pool-size` is 256 MB (the whole
   database was 7 MB with 120 load-test students); raise it to 512 MB-1 GB on the 16 GB server for headroom as
   run history grows.

## 6. Layout

```
app/core        config, database, security (argon2 + JWT), deps (auth, roles), redis, rate limit, logging, errors
app/models      15 tables          app/schemas   request/response models
app/services    all business rules (routers only validate and delegate)
app/api/v1      routers + websockets              app/worker    Celery app, tasks, sandbox
sandbox-image/  Dockerfile + boot.py of the runner image
alembic/        migrations         tests/        pytest suites      loadtest/   Locust + helpers
docs/schema.dbml   database diagram for https://dbdiagram.io (paste the file in). Regenerate after changing a model:
                   docker compose exec api python -m tools.generate_dbml -o docs/schema.dbml   (a test checks it is current)
nginx/          proxy, rate limits, WebSocket upgrade             gunicorn.conf.py   docker-compose*.yml
```

Known limitations: the `uvicorn.workers` module used by gunicorn (as your stack specifies) is deprecated upstream in
favour of the separate `uvicorn-worker` package; it works today, and switching is a one-line change if it is ever
removed.
