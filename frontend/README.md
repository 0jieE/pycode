# Laboratory Management System: Frontend

The web app of the _LAN-Based Laboratory Management System with Integrated Python Coding Environment for
BSIT Students of Colegio de Kidapawan_. Admins manage accounts, instructors run classes and lab sessions
and watch them live, students write and run Python in their own workspace.

React 18 · TypeScript (strict) · Vite · Tailwind CSS v4 · react-router 6 · TanStack Query · zustand ·
CodeMirror 6. Tests: Vitest and Playwright. It talks to the FastAPI backend in `../backend`.

**It makes no request to the internet.** Fonts, scripts and styles are all bundled; nothing comes from a
CDN. A Playwright test (`e2e/offline.spec.ts`) fails if any page asks a host other than its own.

---

## 1. Development setup

You need Node 22 or newer and the backend running (`docker compose up -d` in `../backend`; see its README).

```powershell
cd frontend
npm i                  # install
npm run gen:api        # (re)generate src/api/schema.d.ts from the running backend's OpenAPI schema
npm run dev            # http://localhost:5173
```

Open <http://localhost:5173>. The dev server proxies `/api` (and its WebSockets) to `http://localhost:80`, so
the browser talks to one origin and the login cookie just works.

Accounts for trying it out (the demo data) are in `../backend/seed_credentials.txt`. The automated tests use a
separate test backend with its own accounts (section 3).
If the database is empty, create them first: `docker compose exec api python -m app.seed` in `../backend`.

**Run `npm run gen:api` again whenever the backend's API changes.** TypeScript then shows exactly what
broke. API types are generated, never written by hand.

### Scripts

| Command                 | What it does                                                                  |
| ----------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`           | Dev server with hot reload on port 5173                                       |
| `npm run build`         | Type-checks, then builds the production app into `dist/`                      |
| `npm run preview`       | Serves `dist/` locally (no backend proxy: use Nginx for the real thing)       |
| `npm run gen:api`       | Regenerates `src/api/schema.d.ts` from `http://localhost/api/v1/openapi.json` |
| `npm run lint`          | ESLint and a Prettier check (must pass)                                       |
| `npm run format`        | Prettier, writes the files                                                    |
| `npm test`              | Unit tests (Vitest)                                                           |
| `npm run test:e2e`      | End-to-end tests against the dev server (see section 3)                       |
| `npm run test:e2e:prod` | The same tests against the production stack served by Nginx                   |

### How the code is organised

```
src/
  api/        client.ts (the only place that calls fetch), errors.ts, ws.ts (WebSockets),
              schema.d.ts (generated), queries/ (one React Query hook per endpoint)
  auth/       AuthProvider, RequireRole (route guard per role)
  components/ ui/ (Button, Dialog, Table, Toast ...), Shell, Topbar, ActivityBar, PageFrame
  features/   admin/ instructor/ student/ workspace/ (the IDE) auth/
  lib/        time.ts (Asia/Manila), paths.ts, csv.ts, format.ts, prefs.ts ...
e2e/          Playwright specs
```

### Look and feel

Two themes, dark (default) and light, chosen in Settings. Both are modern and calm with an indigo-blue brand colour
and a violet accent (the status bar and the avatar run from one to the other). Every colour, size and corner is a
token in `src/styles/index.css`, which also defines the light theme's values; components never use raw colours, so
changing the look means editing that one file.

- **Type**: Inter, 14px body text, 24px page titles (`--text-*`); JetBrains Mono 14px in the editor and terminal.
- **Pages** share one width rule, the `page` utility (full width up to 1440px), and are built from `card`s (rounded,
  bordered, a soft shadow).
- **Buttons**: `<Button>`, and `buttonClass()` (`components/ui/buttonStyles.ts`) for links that act as buttons, so
  both are the same size and colour everywhere. Fields are 36px tall.
- The sign-in pages sit on a soft brand glow (`auth-backdrop`). Printed slips stay black on white.

**Every role** has the same frame (`components/Shell.tsx`). Pages without a list beside them (Account settings)
use `components/PageFrame.tsx`; Classes, My classes and Labs add their list as a second side bar, and so do the
administrator's pages (`components/SidePanel.tsx`: Users by role, Registration Codes by batch, Storage by role;
the search stays in the page):

- a **top bar** on every page: the path (for a student My classes › the class › Workspace; for an instructor
  Classes › the class › Activity › Submissions ...), the page's own buttons (the IDE puts Instructions, Submit
  and the editor theme there, through `TopbarActions`) and who is signed in;
- a fixed **icon strip** (`components/ActivityBar.tsx`) that never opens, with tooltips;
- a **second side bar** with a search box: the list of the user's classes
  (`features/student/ClassListPanel.tsx`, `features/instructor/InstructorClassPanel.tsx`). Choosing a class
  opens it in the page next to it; until one is chosen the page says "Select a class". The instructor's list
  shows how many students wait for approval beside each class and has a toggle for archived classes and a **+**
  to create a class (archiving is done from the class's own page). The student's IDE brings its own explorer
  as its second side bar instead.

### Account settings and the forced password change

Every role has **Account settings** (`/account`; click your name in the top bar, or the badge in the icon strip
or the administrator's side bar):

- **Profile**: full name and username can be edited (a username is lower case, 4–32 characters of `a-z 0-9 . _`;
  a taken one is refused next to the field). The form sends only the fields that changed, because the server
  refuses a request that carries anything it does not allow. Role, student number and whether the account is
  active are shown but read-only: only an administrator changes them. The user stays signed in.
- **Password**: current password, then the new one typed twice (checked in the browser, never sent), 8 to 128
  characters. This device stays signed in. After 5 wrong tries in 15 minutes the server answers 429 and the
  form says to try again in a few minutes.
- **Forced change**: a user whose password an administrator reset (or who came from a CSV import) has
  `must_change_password`. They can sign in, but every page sends them to the **Change your password** screen
  (`/change-password`) until they have chosen their own: the route guard looks at the flag, and any request
  answered 403 `PASSWORD_CHANGE_REQUIRED` (or a refused WebSocket) triggers the same redirect
  (`api/client.ts`, `auth/AuthProvider.tsx`). The Users table marks such accounts "Must change password".

### Settings and themes

The gear above the account badge (in the icon strip, or the administrator's side bar) opens **Settings**:

- **Theme**: Dark (default), Light, or System (follows the computer's light/dark setting).
- **Code editor colours**: Match theme (default), Dark or Light.

A choice applies at once and is saved to the account (`PATCH /auth/me/preferences`; the user object carries
`preferences`), so it follows the user to any computer. The last theme shown is also kept in the browser, so a
page load starts with it instead of flashing dark (`src/lib/theme.ts`, applied in `main.tsx` and by
`components/ThemeController.tsx`). The light theme is a second set of values for the same colour tokens
(`:root[data-theme='light']` in `src/styles/index.css`); components use tokens such as `text-ink-strong` and
`bg-hover` instead of white, so they work in both. Printed registration-code slips are always black on white.

### Search and filters on tables

Every table has the same toolbar (`components/ui/TableToolbar.tsx`): a search box, filters where they make
sense, a count ("3 of 20 activities") and a **Clear** button; when nothing matches, the table says so and
offers to clear. Search ignores capitals and accents and needs every word typed to appear somewhere in the row.

| Table                                          | Search looks at                             | Filters                                |
| ---------------------------------------------- | ------------------------------------------- | -------------------------------------- |
| Users                                          | name, username, student no. (on the server) | Role                                   |
| Registration codes                             | last 4 characters, batch, student no.       | Batch, Meant for (a student or anyone) |
| Classes (the list on the left)                 | name, year and section, school year         | none (archived classes toggle)         |
| Students (approved, and waiting requests)      | name, username, student no.                 | none                                   |
| Invite codes                                   | the code                                    | Status                                 |
| Lab sessions                                   | batch name                                  | Status                                 |
| Activities                                     | title                                       | Status, Due date                       |
| Submissions (and the "not yet submitted" list) | student name, username, no.                 | Result, Score                          |
| Live monitor                                   | student name, username, no.                 | the existing chips                     |

Only the Users list can be searched by the server. The others load the whole list (all pages) and search
it in the browser (`lib/tableView.ts`), so a search covers every row, not just the page on screen.

### Sign-up and registration codes

Students create their own account at **`/signup`** (linked from the login page) with a **one-time registration
code** from an administrator. The form asks for the code (it formats itself as `XXXXX-XXXXX`), student number,
full name, username (4–32 characters: lowercase letters, digits, `.` and `_`) and a password typed twice.
There is no email field anywhere in the app. On success the server signs the student in and they land on My
classes. A wrong, used or expired code always gets the same answer ("Invalid or expired code"), on purpose.

Administrators manage the codes under **Registration Codes** in the sidebar:

- **Generate**: one code (optionally tied to a student number, with a prefilled name) or up to 200 for a batch,
  with an optional expiry. The server keeps only a hash, so **the codes are shown once**, in a dialog that can
  only be closed with _Done_. From there: _Copy all_, _Download CSV_ (`code, batch, student_no`) and _Print_,
  which prints cut-out slips, 10 per A4 page, each with the code, batch, expiry and the sign-up address.
- **Unused codes** are listed by their last 4 characters. The side bar lists the batches (with how many unused
  codes each has; + generates codes); choosing one shows its codes, and after _Done_ the page moves to the new
  batch. A code leaves the list as soon as it is used, and a batch with none left leaves the side bar. _Revoke_ removes one code, _Revoke whole batch_ removes every unused code of a batch (the
  confirmation says how many).
- Sign-up is rate limited by Nginx (5 attempts a minute per computer) to stop code guessing; the page tells the
  student to wait a minute when that happens.

### Automatic grading (test cases)

An activity can have up to 20 **test cases**: input, expected output, points, a match mode (trim, exact,
ignore case, contains) and a _Hidden_ switch. The program that is run (the entry file, `main.py` by default) and
"Ignore `input()` prompt text when testing" (on by default) are settings of the activity.

- **Instructor**: the activity editor has a **Test cases** tab (it needs a saved draft). The list reorders by
  drag and drop or with the arrows; the editor beside it saves each case; **Try** runs the saved case against
  the starter files and shows the actual output, the expected output and a line-by-line difference. Changes
  apply at once, even after publishing. On the submissions page each row has a **Score** (e.g. 7/10, click the
  heading to sort), **Re-grade all** grades every submission again (after fixing an expected output), and the
  submission viewer shows the score.
- **Student**: when the folder being worked on belongs to an activity with tests, a **Test** button appears next
  to Run and the panel under it gets a **TEST RESULTS** tab. The card says "Passed 2 of 3 tests · 2/3 pts" (green
  when everything passes, red otherwise) with one row per case, Timeout / Memory badges, and sample cases that
  expand to Input, Your output, Expected output and the difference. A hidden case shows only "Hidden test —
  Pass/Fail": the server never sends its input, its output or its expected output.
- **Exact** compares character for character (spaces, capitals and blank lines count) but, on the server,
  ignores one line break at the very end on both sides, so `print("Hello World")` matches an expected output
  typed as `Hello World`. The line-by-line difference shown to students follows the same rule.
- **Hardcoded answers**: each case has **Program must read all the input** (on by default): with input, the case
  passes only if the program read all of it, else it fails as _Input not read_ with the server's sentence
  ("read 0 of 2 values"). **Code requirements** (Test cases tab: functions to define, at least one of
  for/while/if/def/class, calls and imports not allowed; `PUT`/`DELETE /activities/{id}/requirements`) are
  checked before the tests: code that breaks one fails every case, and the reason is shown once above the
  results. Students see them in sentences next to the instructions (workspace _Instructions_, class home).
  When grading finds a hidden case's expected answer written in the code, the submissions list and viewer show
  **Possible hardcoded answer** with the case names (instructors only; the score is unchanged).
- The server allows one job at a time and 3 seconds between a student's jobs, so pressing Test (or Run) too
  soon is answered with a short wait instead of a failure.
- **Known gaps (the API does not offer them yet)**: the instructor's submission viewer shows the score but not
  each case's result (grading results are only readable by the student who owns them); the Live monitor's
  _Tests_ column shows each student's latest Test from live events only (the snapshot has no score); and the
  class home shows the student's _last Test_ (kept in this browser), not the graded score, because
  `my-submissions` carries no score.

### Interactive runs (programs that ask for input)

The run panel has an **Input** switch: **Interactive** (the default) or **Use input list** (the old Program input
box, one value per line). **Test** and grading always use the list.

- In Interactive mode a program stops at every `input()` and a box floats over the bottom of the terminal:
  "Program is waiting for input", the prompt (the last unfinished line of output), one field (Enter sends) and the
  buttons Send, **End input (EOF)** (`input()` then raises EOFError) and **Stop program**. It is not a browser
  modal: the output behind it can still be scrolled and read. The status line counts down the 2 minutes the
  server allows ("Waiting for input… 1:45"); after that the run ends as `input_timeout`.
- The server echoes each typed line back as output, so the page does not print it again: it only **colours** the
  echoed text (`features/workspace/interactive.ts`, `trackEcho`). The output you see is exactly what the server
  stored.
- When an interactive run ends, the lines typed into it fill the input list and **Run again with same inputs**
  appears: it runs the program in list mode with them, with no questions.
- **Stop** (next to Run) ends an interactive run, also while it is still queued. A list-mode (batch) run cannot be
  stopped: the server ignores the message. New end states: `stopped` and `input_timeout`.
- Messages (`/ws/run/{id}`): server → `input_request`; client → `{"type":"stdin","data"}`, `{"type":"eof"}`,
  `{"type":"stop"}`. A refused line (too long, 200 inputs reached) is shown in the box and the program keeps
  waiting.

### My workspace (Practice)

Every student **and instructor** has a personal workspace, shown as **My workspace** (icon strip entry; the address and the API still call it Practice: `/practice`): their
own files, not tied to any class, never locked by a lab session, nothing to submit, and private to its owner
(students cannot see an instructor's, instructors cannot see a student's). Administrators have none, so the
page sends them home.
It is the _same IDE_ as a class workspace. The IDE is handed a **workspace scope** (a class id, or
`'practice'`), and `src/api/workspaceScope.ts` is the one place that knows which endpoints that means
(`/workspace/{class_id}/...` or `/practice/...`). Class-only parts (activities, lab status, Submit,
the class live connection) are simply absent in Practice, and the Run panel shows "Practice mode".
An **instructor** can right-click a folder of their own (one with no folders inside) and choose **Attach to
activity…**: pick a class, and the folder's files become the starter files of a new draft activity named after
the folder (or replace those of a draft not published yet), then the activity editor opens
(`features/workspace/AttachToActivityDialog.tsx`).
When a class lab is closed, the read-only banner links to Practice (in a new tab, so any text the
student could not save stays in the class tab).

### Due dates, starter files and read-only folders

- **Starter files** (and an activity's folder, and folders holding starter files) can be edited but not deleted,
  renamed or moved: the tree's `protected` flag greys out Delete and Rename / move ("(starter file)"), and the
  server refuses with `403 STARTER_FILE_PROTECTED`. Files students create themselves stay fully theirs.
- **At the due date an activity closes.** Its folder turns read-only (a lock in the tree, the editor read-only with
  the server's reason) and Submit is off ("Past due"); reading, Run and Test still work. There are no late
  submissions: the instructor moves the due date to give more time, which unlocks it at once. Old submissions
  marked Late before this rule keep their badge.
- One source decides: each tree entry's `read_only_reason` (past due or archived). A save refused with
  `ACTIVITY_PAST_DUE` / `ACTIVITY_ARCHIVED` (the deadline passed while the file was open) locks the folder too,
  and the tree is fetched again the moment the next due date passes.

### Workspace storage limits

- Administrators set how much each workspace may hold under **Storage** in the sidebar: the largest file, the
  workspace size and the number of files, one card per role (students, instructors; `GET /storage-limits`,
  `PATCH /storage-limits/{role}`). They apply to **each** workspace of a user (every class workspace and
  Practice). Sizes are typed in KB or MB and sent in bytes; the inputs check the server's `bounds` and that one
  file is not larger than the workspace (`400 INVALID_STORAGE_LIMITS` otherwise). **Use the defaults** fills in
  100 KB, 2 MB and 100 files.
- One person's own limits: **Storage** on their row in Users (not for administrators, who have no workspace;
  `GET`/`PUT /users/{id}/storage`). An empty field follows the role; the dialog also lists each of their
  workspaces with its use, marked **Over the limit** where it is.
- **Clear** next to a workspace there (after a confirmation that says how much goes) deletes all its files and
  folders with their versions (`POST /users/{id}/workspaces/{workspace_id}/clear`). A class workspace gets the
  starter files of the class's published activities back; Practice is left empty; submissions are kept. A
  student with a file open is not told live: their next save (or opening a file from the old tree) gets
  `404 FILE_NOT_FOUND`, which closes the tab, reloads the tree and says "This file no longer exists."
- Lowering a limit deletes nothing. The workspace's quota bar (from the tree's `usage`, which carries the
  user's own limits) says **Over the limit** while saves that make it bigger are refused. Starter files may be
  as large as the students' file limit: the client only stops files over 1 MB (the highest possible limit), the
  server names any file over the real one.

### Deleting and archiving activities

- **Drafts** (never published) have **Delete**, on the Activities tab and in the activity editor: no student has
  them, so they go with their starter files and test cases.
- **Published** activities have **Archive** instead: students stop seeing the activity (no Test, no Submit), its
  folder stays in their workspace read-only (it still runs), and submissions and grades are kept. **Show archived
  activities** lists them again, with **Unarchive**.
- The tree does not mark an archived folder yet, so the workspace finds out at the first refused save
  (`403 ACTIVITY_ARCHIVED`): the typed text goes back to the saved version, the folder's files turn read-only and
  the server's message is shown once (`saver.ts`, `archived` in `workspaceStore.ts`).

### Python Tutorial

`/tutorial` (`features/tutorial/`, loaded on demand like the IDE). Lesson text is Markdown, drawn with
`react-markdown` + `remark-gfm` (tables), both bundled; no raw HTML is rendered.

- **Students**: the lessons are the second side bar (passed, current, locked) with a progress bar
  ("9 of 25 completed"); `/tutorial` opens where they left off. A lesson shows its text, its examples as code cards,
  and the exercise. **Try it** opens the example in a pane on the right (editor, Run, Reset, terminal);
  `input()` asks in the same box as the workspace. The exercise editor is autosaved (`last_code`), **Run** runs
  it, **Check** runs its tests with the same results panel as an activity's Test (sample tests show input,
  expected output and a diff; hidden ones only Pass or Fail). All passed: a banner and **Next lesson**.
  Ctrl+Enter runs (the Try it code when the cursor is in it), Ctrl+Shift+Enter checks. Runs go through
  `/tutorial/run` and are never blocked by lab sessions; the workspace's runner and tester are reused
  (`useTutorialTools.ts`).
- **Administrators and instructors**: the same page edits the lessons. Drag lessons in the side bar to reorder;
  **+** adds one (it starts hidden). Each lesson has tabs: Text (Markdown with a live preview), Examples,
  Exercise (task, starter code, reference solution, file to run, ignore input prompts) and Tests (the same fields
  as an activity's test cases, `TestCaseFields.tsx`). **Hide from students / Show**, **Reset to default** (lessons
  that came with the system), **Delete lesson** (only lessons staff added: built-in ones can be hidden, not
  deleted; students' progress on it goes too) and **Save**. Administrators also have **Load default lessons** (asks first: it
  resets edited default lessons).
- **Class page, tab Tutorial progress** (instructors): students × lessons (✅ passed, a number = checks without a
  pass yet, empty = not tried), completion, sort by completion or name, search, filter by progress, **Export
  CSV**, and the **Unlock lessons in order** switch (on in any of a student's classes = on for that student).

### Labs

- **Labs** (`/labs`, administrators and instructors; `features/labs/`): a lab is just a **named computer room**
  that sessions book. The list of labs is the second side bar; administrators add a lab with **+**, and
  **Rename** or **Delete** it on its page (`409 LAB_NAME_TAKEN` for a name already used; a lab with sessions that
  have not ended cannot be deleted, `409 LAB_HAS_SESSIONS`). Instructors see the labs read-only.
- Each lab's page shows **Upcoming sessions** (`GET /labs/{id}/schedule`) **by day**: a 7 AM – 9 PM timeline of
  the bookings, and the free time between them, so a vacant slot is easy to find.
- **The lab of a session** is **required**: chosen when creating a session, or later with **Lab** (session list)
  / **Change lab** (monitor), which sends `PATCH /sessions/{id} {lab_id}`. Under the lab picker, **Already booked
  in this lab** shows the same day-by-day schedule. The server refuses overlapping bookings of a room
  (`409 LAB_BOOKED`) and moving a running session into a room in use (`409 LAB_IN_USE`); its message, naming the
  other class and instructor, is shown as is. Sessions are called `name` in the API (registration codes keep
  `batch_name`).
- The monitor's **Sign-ins** tab lists who signed in during the session and how it went (signed in, or took
  over a sign-in on another computer).

Ground rules the code follows:

- All HTTP goes through `api/client.ts` (cookie included, errors parsed into `ApiError`, any 401 signs the
  user out). Components never call `fetch` themselves.
- The backend decides every rule. The client only pre-checks (file names, CSV rows, dates) to give quick,
  friendly messages; the server's answer is always shown.
- Dates arrive in UTC and are shown in **Asia/Manila**. Date pickers are read as Manila time too.
- Nothing sensitive is stored in the browser: no token (it is an httpOnly cookie), no password, no code.
  Only UI preferences (editor theme, pane sizes) go to `localStorage`.
- Open tabs and unsaved text in the workspace are keyed by file **id**, so renaming a folder keeps them.

---

## 2. Production build and deploying on the LAN server

In production the backend's Nginx serves the built app **and** proxies `/api/`, so there is a single
address and a single port (80) on the LAN. Nginx serves `frontend/dist` (mounted read-only into the
container by `../backend/docker-compose.yml`), sends `index.html` for every page address (so reloading
`/classes/3` works), caches the hashed files in `assets/` for a year and never caches `index.html`.

### First install

The project lives in one repository with `backend/` and `frontend/` side by side, and the built app
(`frontend/dist`) **is committed**, so a computer with Docker but **no Node.js** can run everything. On the server
(see `../backend/README.md` for the backend part, its `.env` and the first admin account):

```bash
git clone https://github.com/0jieE/pycode.git
cd pycode/backend
# the backend's .env and start command, as in backend/README.md, e.g.:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Nginx serves `../frontend/dist` straight from the clone: nothing to build. Then open `http://<server address>/`
from any lab PC. Keep `COOKIE_SECURE=false` in the backend `.env` while the LAN uses plain `http`.

### Updating to a new version

```bash
cd pycode
git pull
```

That is all for the frontend: **no build and no restart are needed** (the pulled `frontend/dist` is the new
app). Browsers fetch the new `index.html` on their next visit and the new hashed files with it. If the backend
changed too, rebuild and restart it as its README says.

Do not delete the `dist` folder itself while the stack runs (the container is attached to that folder; a pull
or a build only replaces what is inside it). If you did, run `docker compose restart nginx` in `../backend`.

### Building the frontend yourself (developers)

Needs Node.js 22+. After changing the frontend, rebuild and commit `dist/` with the sources, so the servers get
it on their next `git pull`:

```bash
cd frontend
npm ci
npm run gen:api     # only when the backend's API changed (needs the backend running)
npm run build       # replaces the files inside frontend/dist
git add -A . && git commit
```

### Checking a deployment

```bash
curl -I http://<server>/                       # 200, Cache-Control: no-cache
curl -I http://<server>/classes/3              # 200, the same page (SPA fallback)
curl    http://<server>/api/v1/health          # {"status":"ok","checks":{"database":"ok",...}}
```

On a lab PC: sign in, open a workspace, press Run. If the page is blank or shows Nginx's 404 at `/`, the
build is missing (`frontend/dist/index.html` must exist); if only Run fails, check `docker` in the health
output above.

Notes for the lab PCs: the app works over plain http. Copy buttons use a fallback that works without https.
Use a current Edge or Chrome. Only port 80 needs to be open to the LAN.

---

## 3. Tests

### Unit tests (Vitest)

```powershell
npm test
```

They run in a second and need no backend. They cover the logic: which endpoints a workspace uses (class or Practice), paths and file-name rules, the tree builder and
folder renames (`treeUtils`), Manila time formatting, the API error parser and client (401 handling), CSV
import preview, the editor store and the saver (one save at a time, conflicts, a closed lab), the run flow
(queue, streaming, polling fallback, 429/503), the WebSocket helper (reconnect backoff, close codes) and the
monitor's live updates.

### End-to-end tests (Playwright)

They drive a real browser against a real backend (including the sandbox that runs Python), but **never the demo
one**: they create classes, sessions and activities as they go. They use a separate **test backend** on port 8081
with its own database and accounts (`admin`, `instructor1`, `instructor2`, `student01`–`student29`).

1. Start it and seed it (in `../backend`; the demo stack on port 80 keeps running untouched):

   ```powershell
   docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build
   docker compose -f docker-compose.yml -f docker-compose.e2e.yml exec api python -m app.e2e_seed
   ```

   The seed writes the passwords to `../backend/e2e_credentials.txt`, which the tests read. Run it again for fresh
   passwords or a known state.

2. Run:

```powershell
npm run test:e2e                              # everything, through a test dev server of its own (started for you)
npm run test:e2e -- e2e/run.spec.ts           # one spec
npm run test:e2e:prod                         # everything, against the test stack's Nginx on http://localhost:8081
```

`npm run test:e2e` starts Vite on port **5174** with `API_TARGET=http://localhost:8081` (see `e2e/env.ts`), so it
never reuses the everyday dev server on 5173, which talks to the demo backend on port 80. For the `:prod` run, build
first (`npm run build`). `E2E_BASE_URL` and `E2E_API` override the addresses.

Progress in the tutorial cannot be reset, so `tutorial.spec.ts` picks a student who has not started it; reseed the
test backend when it runs out of them.

| Spec                      | What it covers                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `journey.spec.ts`         | The whole course of a lab through the UI only: admin creates a student, instructor makes a class and code, the student joins, approval, session open, activity published, the student edits/saves/runs/submits, access closed (read-only), a second login kicks the first                                         |
| `offline.spec.ts`         | Walks every major screen as all three roles and fails if any request goes to another host                                                                                                                                                                                                                         |
| `auth.spec.ts`            | Login for each role, wrong password, route guards, the "signed in on another device" banner                                                                                                                                                                                                                       |
| `admin.spec.ts`           | Users table, create/edit/deactivate, reset password (shown once), CSV import                                                                                                                                                                                                                                      |
| `instructor.spec.ts`      | Classes, invite codes (window, switch, badges), approvals, sessions, activities, submissions                                                                                                                                                                                                                      |
| `student.spec.ts`         | Joining, class home with Submitted/Late badges, the whole workspace (autosave, versions, conflicts, rename, delete, quick open, submit, read-only)                                                                                                                                                                |
| `run.spec.ts`             | Run in the real sandbox: streaming, input, imports, crashes, timeout and output limit, 429/503, socket failure                                                                                                                                                                                                    |
| `realtime.spec.ts`        | Lab closing/opening, new activity, the live monitor, the instructor's student viewer                                                                                                                                                                                                                              |
| `signup.spec.ts`          | Self sign-up: the admin generates a code, a student signs up with it and lands on My classes, the same code fails the second time; form checks, the server's 409 messages, a code tied to a student number, bulk codes with Copy / CSV / print slips, revoking one code and a whole batch, the rate-limit message |
| `tests.spec.ts`           | Automatic grading: the instructor adds a sample and a hidden case, reorders and tries one; the student's Test fails (a hidden case reveals nothing), the student fixes the code and passes, submits, and the instructor sees the score, sorts by it and re-grades                                                 |
| `tableSearch.spec.ts`     | Search boxes and filters on the students, activities, submissions and classes tables: counts, clear, no match, filter plus search                                                                                                                                                                                 |
| `attachFolder.spec.ts`    | An instructor's flat My workspace folder becomes a draft activity with its files; a folder with folders inside cannot                                                                                                                                                                                             |
| `activityArchive.spec.ts` | A draft is deleted; an archived activity disappears for the student, its folder turns read-only but still runs; unarchive brings it back                                                                                                                                                                          |
| `sessionEnd.spec.ts`      | A session closes itself at its end: the student's workspace turns read-only ("the lab session has ended"); an ended batch can't be opened until its end time moves; Extend 30 min                                                                                                                                 |
| `adminShell.spec.ts`      | The administrator's frame: fixed icon strip, top-bar path, and Labs with its list of rooms on the left (+ New lab, the icon hides/shows the list)                                                                                                                                                                 |
| `tutorial.spec.ts`        | A new student: lesson 1 "Try it" runs, Check passes it, progress shows 1 of N; with lessons in order, lesson 3 is locked until lesson 2 passes                                                                                                                                                                    |
| `tutorialEditor.spec.ts`  | A lesson an instructor added can be deleted; a built-in lesson shows Reset to default, not Delete                                                                                                                                                                                                                 |
| `practice.spec.ts`        | The Practice workspace: sidebar entry, "Practice mode", create/autosave/versions/run, always editable while the class lab is closed, private from the class and the instructor, the banner link                                                                                                                   |

Things to know when running them:

- **One account is signed in once at a time** (the backend's rule), so the specs run one after another and
  each uses its own accounts (`student01`..`student15`, plus new `su*`, `journey.*` and `e2e.*` accounts, `instructor1`/`instructor2`, `admin`). Do not use
  those accounts by hand during a test run, and do not run two test runs at once.
- **They leave data behind**: extra users (`e2e.*`, `journey.*`), classes ("E2E ...") and their runs.
  It is harmless. To start clean: `docker compose down -v` in `../backend`, bring it up, run the seed again.
- **`signup.spec.ts` takes about a minute and a half**: Nginx allows only 5 sign-ups a minute from one computer, so the spec
  paces itself (and waits and retries once if it is refused). Each run uses fresh usernames and codes.
- **Do not run them while the backend's Locust load test is running**: the Run tests would wait in the same
  queue (and skew the load-test numbers).
- The browser is the **Microsoft Edge** that comes with Windows (`channel: 'msedge'` in
  `playwright.config.ts`), so nothing is downloaded. For another machine, run `npx playwright install chromium`
  and remove that line.
- Failed tests keep a trace in `test-results/`. Open one with `npx playwright show-trace <trace.zip>`.

---

## 4. Troubleshooting

| Symptom                                                            | Cause and fix                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Back at the login page with "You were signed in on another device" | The account was used somewhere else. One device per account is intended: sign in again.                                               |
| `npm run gen:api` fails                                            | The backend is not running or not on port 80. Start it, or set `NGINX_PORT` back to 80.                                               |
| Blank page or Nginx 404 at `/` after deploying                     | `frontend/dist` is missing or empty: run `npm run build`. Then `docker compose up -d nginx` once.                                     |
| Run stays on "Saving…" or never answers                            | Check `http://<server>/api/v1/health`: `docker` must be `ok`. The worker needs the Docker socket and the `lab-python-runner:1` image. |
| Student shows offline on the monitor although the page is open     | Their class WebSocket is not connected. Reload the page; check Nginx passes `/api/v1/ws/` (see its config).                           |
| Tests hang or fail with `ENOSPC`                                   | The disk is full. Free space first, then run again.                                                                                   |
| Editor text looks wrong in a language other than English/Filipino  | Only the Latin font subset is bundled, to keep the build small.                                                                       |
