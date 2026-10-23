# BUILD PROMPT — Frontend of the LAN-Based Laboratory Management System

You are building the **frontend** of the capstone *"LAN-Based Laboratory Management System with Integrated Python Coding Environment for BSIT Students of Colegio de Kidapawan."*

- Work inside `frontend/` only.
- The finished backend lives in `../backend` (FastAPI). **Read it, don't change it**, except for the one Nginx change allowed in Phase 6.
- Build **one phase at a time**. At the end of each phase:
  - run the checks
  - show me what was built and how to try it
  - **stop and wait for my "go"**

---

## 1. Ground truth = the backend

Before writing code, read these:

- `../backend/BACKEND_PROMPT.md` (what the system does and its rules)
- `../backend/README.md`
- `../backend/app/api/v1/*.py` (all routes)
- `../backend/app/schemas/*.py` (exact request/response shapes)
- `../backend/app/api/v1/ws.py` (WebSocket protocol)
- `../backend/app/services/monitor_service.py` (monitor event shapes)

**Types:**
- Generate TypeScript types from the live OpenAPI schema. Never hand-write API shapes.
- Run `npx openapi-typescript http://localhost/api/v1/openapi.json -o src/api/schema.d.ts`.
- Add it as an `npm run gen:api` script.

The backend runs with `docker compose up -d` in `../backend`. The API is at `http://localhost/api/v1`, and the interactive docs are at `/api/v1/docs`.

**Seed accounts:** `../backend/seed_credentials.txt` has 1 admin, 2 instructors and 40 students. If the DB is fresh, run `docker compose exec api python -m app.seed`.

### Backend facts you must respect

| Topic | Rule |
|---|---|
| **Auth** | `POST /auth/login {username,password}` sets an **httpOnly cookie**, so JS never sees the token. Every request uses `credentials: 'include'`. `GET /auth/me` returns the user, including `role`. `POST /auth/logout` logs out. |
| **Single session** | Logging in elsewhere invalidates the old session. Any **401** means: clear state, go to `/login`, and show the message "You were signed in on another device" when the error `code` says so. |
| **Errors** | Every error body is `{detail, code}`. Show `detail` in a toast and branch on `code`, never on text. |
| **Pagination** | List endpoints take `?page=&size=` (max 100) and return `{items,total,page,size}`. |
| **Dates** | The API sends UTC ISO strings ending in `Z`. Display in **Asia/Manila** using `Intl.DateTimeFormat`. Send datetimes as ISO UTC. |
| **Saving files** | `PUT /workspace/files/{id}` takes `{content, last_updated_at}`. `last_updated_at` = the file's `updated_at` string from the last response, **echoed byte-for-byte** (it has microseconds, so never parse or reformat it). Every save response returns a new `updated_at`: store it. A mismatch returns **409**. `?version=true` also creates a version. |
| **Access closed** | When no lab session is open, workspace writes and Run return **403** (`code` tells you). The workspace must then switch to **read-only**. |
| **Run** | `POST /workspace/{class_id}/run {entry_path, stdin}` returns **202** `{execution_id, queue_position}`. It can also return **429** (already running, or rate-limited to 1 run every 3 s) or **503** (server busy). `GET /executions/{id}` returns the stored result. |
| **Tree** | `GET /workspace/{class_id}/tree` returns `{entries:[{id,path,is_folder,size_bytes,updated_at}], usage}`. There is **no content** in it; fetch content per file. Paths are case-insensitive: `A.py` and `a.py` collide. |
| **Workspace limits** | Allowed extensions: `.py .txt .csv .json .md`. Max 100 KB per file. Show the quota from `usage`. |

### WebSockets

All three sockets are under `ws(s)://<host>/api/v1/ws/...` and use the same cookie.

**Close codes:**
- `4401` not signed in / session replaced, so go to login
- `4403` forbidden
- `4404` not found
- `4408` idle

Before an error close, the server sends `{"type":"error","code","detail"}`.

**`/ws/run/{execution_id}`** (the run's owner)
- Receives `status`, `output` `{data}` chunks and `done` `{status, exit_code, duration_ms, output?}`.
- **If `done` carries `output`, use it as the final text.** Replace the streamed text with it.
- If the socket fails, fall back to polling `GET /executions/{id}` every 1 s until the status is final.

**`/ws/class/{class_id}`** (approved students and the instructor)
- Receives `connected`, `session_opened`, `session_closed`, `activity_published` `{activity_id, title}`, and `pong`.
- **Students must send `{"type":"ping"}` every 25 s.** That's their presence heartbeat; without it they show as offline after 30 s.

**`/ws/monitor/{lab_session_id}`** (the owning instructor)
- Receives events shaped `{type: run|run_done|saved|submitted|online|offline, student_id, student, ts, ...}`.
- Start from `GET /sessions/{id}/monitor`, which returns a snapshot of every student (online, last_run, last_save, submitted), then apply live events on top.

**Reconnects:** reconnect with exponential backoff (1 s up to 15 s), except after `4401`, `4403` or `4404`.

## 2. Stack (fixed — do not substitute)

| Need | Choice |
|---|---|
| Build | **Vite + React 18 + TypeScript (strict)** |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite`) |
| Routing | **react-router v6** (data router) |
| Server state | **@tanstack/react-query** |
| Client state | **zustand** (open tabs, dirty buffers, UI prefs) |
| Editor | **CodeMirror 6** via `@uiw/react-codemirror` + `@codemirror/lang-python` (+ `@codemirror/lang-json`, `lang-markdown` for those files) |
| Icons | `lucide-react` |
| Fonts | **self-hosted** via `@fontsource/*` packages |
| Tests | **Vitest** + Testing Library for logic; **Playwright** for end-to-end against the running backend |

**This is a LAN-only system.** The built app must make **zero requests to the internet**:
- no CDNs
- no Google Fonts
- no analytics
- no remote images

Everything must be bundled by Vite. Don't add other libraries without asking me first. If something here conflicts with the backend, the backend wins: tell me.

**Dev setup:** in `vite.config.ts`, proxy `/api` to `http://localhost:80` with `ws: true`. The browser then talks to one origin, and cookies just work. Run with `npm run dev` on port 5173.

## 3. Folder structure

```
frontend/
├── src/
│   ├── main.tsx  App.tsx  router.tsx
│   ├── api/        schema.d.ts (generated)  client.ts  errors.ts  queries/*.ts  ws.ts
│   ├── auth/       AuthProvider.tsx  RequireRole.tsx
│   ├── components/ ui/ (Button, Dialog, Toast, Table, Badge, Pagination, ConfirmDialog, EmptyState)
│   │               AppShell.tsx  Sidebar.tsx
│   ├── features/
│   │   ├── admin/        UsersPage  UserFormDialog  ImportUsersDialog
│   │   ├── instructor/   ClassesPage  ClassDetailPage (tabs: Students · Invite Codes · Sessions · Activities)
│   │   │                 ActivityEditor  SubmissionsPage  SubmissionViewer  MonitorPage  StudentWorkspaceViewer
│   │   ├── student/      MyClassesPage  JoinClassDialog  ClassHome (activities list)
│   │   └── workspace/    WorkspacePage  FileTree  EditorTabs  CodeEditor  RunPanel  Terminal
│   │                     VersionsDrawer  useAutosave.ts  useRun.ts  useClassSocket.ts  treeUtils.ts
│   ├── lib/        time.ts (Asia/Manila formatting)  paths.ts  debounce.ts
│   └── styles/     index.css (Tailwind + theme tokens)
├── e2e/            Playwright specs
├── vite.config.ts  tsconfig.json  package.json  README.md
```

**Rules:**
- All HTTP goes through `api/client.ts`, a typed `fetch` wrapper:
  - `credentials:'include'`
  - parses `{detail, code}` into an `ApiError`
  - handles 401 globally
- Components never call `fetch` directly.
- One React Query hook per endpoint in `api/queries/`.

## 4. Screens and behavior

**Roles** (redirect to the right home after login):
- `admin` → `/admin/users`
- `instructor` → `/classes`
- `student` → `/my/classes`

`RequireRole` guards every route.

### Login
- Username and password fields, with errors shown inline.
- A "signed in on another device" banner when redirected for that reason.

### Admin
**Users table:**
- Search, role filter, pagination.
- Create, edit, activate/deactivate.
- **Reset password:** show the new temporary password **once**, with a copy button.

**CSV import:**
- Accepts `student_no, full_name, username, temp password`.
- Before uploading, preview the parsed rows and flag bad ones.
- After uploading, show the backend's `ImportResult` (created, skipped, errors per row).

### Instructor
**Classes:** list and create (name, section, school year), plus archive.

**Class detail tabs:**
- **Students:**
  - Pending requests on top, with **Approve / Reject** buttons and approve-all.
  - Then approved students, with **Remove** behind a confirm dialog.
  - Each approved student links to a read-only view of their workspace.
- **Invite codes:**
  - Create with a validity window (local date-time pickers, sent as UTC) and an optional max uses.
  - Big copyable code.
  - **Active on/off toggle**, plus edit window.
  - Status badge: Active, Expired, Not yet valid, Disabled or Used up.
- **Sessions:**
  - Create a batch (name, start, end).
  - A large **OPEN / CLOSE ACCESS** control with clear status.
  - Only one session can be open; show the backend error if the instructor tries a second.
  - Session history.
- **Activities:**
  - Create and edit: title, instructions (plain text or Markdown shown as text), due date.
  - **Starter files editor:** a mini file list plus CodeMirror, reusing the workspace components.
  - Before publishing, warn: *"Title and starter files can't change after publishing."*
  - Then **Publish**.

**Submissions:**
- Per activity: student, time, an **On time / Late** badge, and not-yet-submitted students.
- **Viewer:** a read-only file tree plus editor showing the frozen snapshot.

**Monitor page** (the open session):
- Live grid or table of every student:
  - online dot
  - last run (status badge, entry file, duration, time ago)
  - last save (time ago)
  - submitted ✓
- Header counts: online, ran code, submitted.
- Filters: all, offline, has errors, not submitted.
- Clicking a student opens their workspace read-only.
- Updates live from `/ws/monitor`, with no page refresh.

### Student
**My classes:**
- Shows status: Pending approval or Approved.
- **Join class** dialog takes an invite code.
- Show the backend's messages for an expired, disabled or used-up code, or a duplicate join.

**Class home:**
- Activities list with due date, Submitted or Late badges, and an **Open in workspace** button.
- A session status banner: *"Laboratory is OPEN"* or *"Laboratory access is closed — read-only"*.

**Workspace (the core screen)** has a three-pane IDE layout. It must fit **1366×768** lab monitors, and the panes are resizable.

- **Left: file tree**
  - Built from flat paths, with folders first and sorted.
  - Right-click menu and toolbar: New file, New folder, Rename/Move, Delete (confirm).
  - Validate names client-side (extensions, no `..`, no leading `.`, case-insensitive duplicates), but still show any server error.
  - A quota bar from `usage`.
- **Center: editor tabs + CodeMirror**
  - Python highlighting, line numbers, bracket matching, auto-indent at 4 spaces, Tab = 4 spaces, a dark theme by default and a light toggle.
  - A **● dot** on unsaved tabs.
  - **Autosave** 2 s after typing stops (no version).
  - **Ctrl+S** saves with `?version=true` and shows a "Saved (version created)" toast.
  - Keep `updated_at` per open file. Never send stale content.
- **Right/bottom: Run panel**
  - **Entry file** selector, defaulting to the active `.py` tab.
  - A **stdin textarea** labeled *"Program input (one value per line, read by input())"*.
  - A **Run** button, plus Ctrl+Enter.
  - A **Terminal** pane, monospaced, which auto-scrolls and has a Clear button.
- **Versions drawer** per file:
  - A list of saved versions (time, size) and a read-only preview.
  - **Restore** copies the version into the editor as unsaved changes. The student then saves normally.
- **Submit** button, when the folder belongs to an activity:
  - Confirm: *"Submit everything in '{activity}'? You can resubmit until…"*.
  - Then show the submitted time.

**Run flow (`useRun.ts`):**
1. Save every dirty file first. Abort on error.
2. Call `POST run`.
3. Show **"Queued — #N"** and open the run socket.
4. Show "Running…" with an elapsed timer.
5. Stream the output.
6. On `done`, show a status line:
   - `ok` → green "Finished in X ms (exit 0)"
   - `error` → red "Exited with code N"
   - `timeout`, `memory_exceeded`, `output_limit` → amber, with a plain-English explanation
   - `system_error` → "Server problem, try again"
7. Disable Run while queued or running.
8. Show **429** and **503** as a friendly inline message with a short countdown.

**Real-time (`useClassSocket.ts`):**
- On `session_closed`:
  - switch the whole workspace to read-only (editor `readOnly`, tree actions and Run disabled)
  - show a banner
  - try one final save of any unsaved changes. If it gets a 403, keep the buffer in memory and show *"Your last changes could not be saved because access was closed"*.
- On `session_opened`: re-enable everything.
- On `activity_published`: refetch the tree and show a toast *"New activity: {title}"*.
- Send the 25 s ping. Reconnect with backoff.

**409 conflict on save:** open a dialog with two options:
- **"Load latest from server"**: discard local changes.
- **"Keep my version"**: refetch to get the current `updated_at`, then save the local content.

## 5. UX, quality and accessibility

- **Visual design:** a clean, calm, school-lab look.
  - Theme colors as CSS variables (Tailwind theme tokens).
  - Light UI with a dark editor by default; a dark UI toggle is a nice-to-have.
  - Status colors are consistent everywhere: ok green, error red, timeout/limits amber, pending gray, open blue.
- **Loading and empty states:** loading skeletons and empty states on every list. No layout jump when data arrives.
- **Keyboard:**
  - All actions reachable by keyboard.
  - Visible focus rings.
  - Dialogs trap focus.
  - Shortcuts: Ctrl+S, Ctrl+Enter, Ctrl+P (quick-open file, optional).
- **Text:**
  - Labels on every input.
  - Plain-English error text.
  - All user-facing text is in English.
- **Performance:**
  - The workspace route is code-split, so CodeMirror only loads there.
  - The terminal caps its display at about 64 KB.
  - Avoid re-rendering the whole tree on each keystroke.
- **TypeScript and linting:** no `any` without a comment. ESLint + Prettier, and `npm run lint` passes.

## 6. Phases (stop after each one)

### Phase 1 — Setup, client, auth, shell
- Vite + TS + Tailwind v4, the proxy, and `gen:api` (types generated and committed).
- `api/client.ts`, `ApiError`, the global 401 handler, React Query setup and toasts.
- Login, logout, `/auth/me` bootstrap, `RequireRole`, AppShell and sidebar per role.
- **Done when:**
  - each seed role logs in and lands on its home page
  - a second login elsewhere kicks the first (after its next request) back to login with the banner
  - `npm run build` passes

### Phase 2 — Admin
- Users table, create/edit, activate/deactivate, reset password (shown once), CSV import with preview.
- **Done when** an imported student can log in.

### Phase 3 — Instructor management
- Classes, invite codes (window + toggle + badges), enrollment approvals, sessions with open/close.
- Activities with the starter-file editor and publish.
- Submissions list and snapshot viewer.
- **Done when** this end-to-end flow works by hand:
  1. create class
  2. create code
  3. student joins
  4. approve
  5. open session
  6. publish activity
  7. the activity folder appears in the student's tree

### Phase 4 — Student workspace
- My classes, join dialog, class home, and the full IDE:
  - tree CRUD
  - tabs
  - CodeMirror
  - autosave and Ctrl+S versions
  - 409 dialog
  - versions drawer
  - quota bar
  - submit
- **Done when:**
  - multi-file `import helpers` works when saved
  - renaming a folder keeps its open tabs pointing at the new paths
  - a closed session makes the workspace read-only (checked via the REST 403 for now)

### Phase 5 — Run + real-time
- `useRun` with the queue position, streaming, final `done` handling, the polling fallback, and 429/503 messages.
- `useClassSocket` with ping, session open/close, `activity_published`.
- Monitor page with snapshot + live events.
- Instructor read-only student workspace viewer.
- **Done when:**
  - output streams live
  - an infinite loop shows the timeout message
  - closing the session flips open student tabs to read-only within about 1 s
  - the monitor updates live when a student runs, saves or submits

### Phase 6 — Production build, Nginx, tests
- `npm run build` creates `dist/`.
- **Allowed backend change:** update `../backend/nginx/nginx.conf` and the compose file so Nginx serves `frontend/dist` at `/` with an SPA fallback (`try_files $uri /index.html`), keeping all `/api/` locations unchanged. Long-cache hashed assets; no-cache `index.html`.
- Show me the diff for these backend files before applying it.
- **Offline check:** a Playwright test that fails if any request goes to a host other than the app's own origin.
- **Playwright end-to-end tests,** using seed accounts against the running stack:
  1. admin login and create a user
  2. instructor creates a code, a student joins, the instructor approves
  3. instructor opens a session and publishes, and the student sees the folder
  4. student edits, saves, runs (output appears) and submits
  5. instructor closes the session, and the student is read-only
  6. second login kicks the first
- **Vitest:**
  - `treeUtils` (flat paths to tree, rename subtree)
  - `paths` validation
  - time formatting
  - the API error parser
- **README:**
  - dev setup (`npm i`, `npm run gen:api`, `npm run dev`)
  - production build and deploy steps on the LAN server
  - how to run the tests

## 7. Quality bar

- Small components and typed props, with no business rules duplicated from the backend beyond friendly client-side pre-checks.
- Never store the token, passwords or student code in `localStorage`. Only UI preferences (theme, pane sizes) may go there, wrapped in try/catch.
- If the spec is unclear or conflicts with the backend, **ask me before guessing**.

**Start with Phase 1 now.**
