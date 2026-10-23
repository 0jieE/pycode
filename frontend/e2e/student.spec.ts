import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { account } from './accounts'
import { createRoom, roomName } from './lab'

/**
 * The Phase 4 flow in a real browser, as a student. The instructor's side (class, code, session,
 * activity, approvals) is set up through the API; every student action goes through the UI.
 */

const run = Date.now().toString(36)
const className = `E2E Student Class ${run}`
const activityTitle = `Lab ${run}`
const lateTitle = `Overdue ${run}`
const STUDENT = 'student10'

const state = {
  classId: 0,
  sessionId: 0,
  activityId: 0,
  lateActivityId: 0,
  code: '',
  instructor: null as APIRequestContext | null,
}

const MAIN = "import helpers\nprint(helpers.greet('world'))\n"
const HELPERS = "def greet(name):\n    return 'hi ' + name\n"

let page: Page

const ins = () => state.instructor!

/** The student's own session also works for API calls: the browser context shares its cookie. */
async function serverEntries() {
  const res = await page.request.get(`/api/v1/workspace/${state.classId}/tree`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()).entries as { id: number; path: string; is_folder: boolean }[]
}

async function serverFile(path: string) {
  const entry = (await serverEntries()).find((e) => e.path === path)
  expect(entry, `${path} should exist on the server`).toBeTruthy()
  const res = await page.request.get(`/api/v1/workspace/files/${entry!.id}`)
  return (await res.json()) as { id: number; content: string; updated_at: string }
}

async function typeAtEnd(text: string) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(text)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  state.instructor = await playwright.request.newContext({ baseURL })
  const login = await ins().post('/api/v1/auth/login', {
    data: { username: 'instructor1', password: account('instructor1').password },
  })
  expect(login.ok()).toBeTruthy()

  const cls = await ins().post('/api/v1/classes', {
    data: { name: className, year_and_section: 'BSIT 4-S', school_year: '2026-2027' },
  })
  state.classId = (await cls.json()).id

  const code = await ins().post(`/api/v1/classes/${state.classId}/invite-codes`, {
    data: {
      // A minute back: the server stores whole seconds, so "now" could still lie ahead of it.
      valid_from: new Date(Date.now() - 60_000).toISOString(),
      valid_until: new Date(Date.now() + 7 * 864e5).toISOString(),
    },
  })
  state.code = (await code.json()).code

  const roomId = await createRoom(ins(), roomName('Student room'))
  const session = await ins().post(`/api/v1/classes/${state.classId}/sessions`, {
    data: {
      name: 'Batch 1',
      lab_id: roomId,
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 40 * 60_000).toISOString(),
    },
  })
  state.sessionId = (await session.json()).id
  expect((await ins().patch(`/api/v1/sessions/${state.sessionId}/open`)).ok()).toBeTruthy()

  const activity = await ins().post(`/api/v1/classes/${state.classId}/activities`, {
    data: {
      title: activityTitle,
      instructions: 'Make main.py greet the world using helpers.py.',
      starter_files: [
        { path: 'main.py', content: MAIN },
        { path: 'helpers.py', content: HELPERS },
      ],
    },
  })
  state.activityId = (await activity.json()).id
  expect((await ins().post(`/api/v1/activities/${state.activityId}/publish`)).ok()).toBeTruthy()

  // A second activity whose deadline has already passed: it is closed (read-only, no Submit).
  const overdue = await ins().post(`/api/v1/classes/${state.classId}/activities`, {
    data: {
      title: lateTitle,
      due_at: new Date(Date.now() - 3600_000).toISOString(),
      starter_files: [{ path: 'main.py', content: 'print("late")\n' }],
    },
  })
  expect(overdue.ok()).toBeTruthy()
  state.lateActivityId = (await overdue.json()).id
  expect((await ins().post(`/api/v1/activities/${state.lateActivityId}/publish`)).ok()).toBeTruthy()

  page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
})

test.afterAll(async () => {
  await state.instructor?.dispose()
})

// -------------------------------------------------------------------- joining

test('1. student joins a class: bad code, then a good one, then waits for approval', async () => {
  await page.goto('/login')
  await page.getByLabel('Username').fill(STUDENT)
  await page.getByLabel('Password').fill(account(STUDENT).password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Join class' }).click()
  const dialog = page.getByRole('dialog', { name: 'Join a class' })

  await dialog.getByRole('button', { name: 'Join class' }).click()
  await expect(dialog.getByText('Enter the invite code from your instructor.')).toBeVisible()

  await dialog.getByLabel('Invite code').fill('zzzzzzzz')
  await dialog.getByRole('button', { name: 'Join class' }).click()
  await expect(dialog.getByText('Invite code not found')).toBeVisible()

  await dialog.getByLabel('Invite code').fill(state.code.toLowerCase()) // typed in lower case
  await dialog.getByRole('button', { name: 'Join class' }).click()
  await expect(dialog.getByRole('status')).toContainText(`Request sent for ${className}`)
  await dialog.getByRole('button', { name: 'Done' }).click()

  const card = page.getByRole('listitem').filter({ hasText: className })
  await expect(card.getByText('Pending approval')).toBeVisible()
  await expect(card.getByRole('link', { name: /Open/ })).toHaveCount(0)
})

test('2. joining again says so, and a switched-off code shows the backend’s reason', async () => {
  await page.getByRole('button', { name: 'Join class' }).click()
  const again = page.getByRole('dialog', { name: 'Join a class' })
  await again.getByLabel('Invite code').fill(state.code)
  await again.getByRole('button', { name: 'Join class' }).click()
  await expect(again.getByRole('status')).toContainText('You already asked to join')
  await again.getByRole('button', { name: 'Done' }).click()

  // A second class with a code that is switched off.
  const other = await ins().post('/api/v1/classes', {
    data: { name: `Closed Code ${run}`, year_and_section: 'X', school_year: '2026-2027' },
  })
  const otherId = (await other.json()).id
  const code = await ins().post(`/api/v1/classes/${otherId}/invite-codes`, {
    data: {
      // A minute back: the server stores whole seconds, so "now" could still lie ahead of it.
      valid_from: new Date(Date.now() - 60_000).toISOString(),
      valid_until: new Date(Date.now() + 864e5).toISOString(),
    },
  })
  const { id, code: text } = await code.json()
  await ins().patch(`/api/v1/invite-codes/${id}`, { data: { is_active: false } })

  await page.getByRole('button', { name: 'Join class' }).click()
  const off = page.getByRole('dialog', { name: 'Join a class' })
  await off.getByLabel('Invite code').fill(text)
  await off.getByRole('button', { name: 'Join class' }).click()
  await expect(off.getByText('This invite code is turned off')).toBeVisible()
  await off.getByRole('button', { name: 'Cancel' }).click()
})

test('3. once approved, the class opens and shows the lab status and the activity', async () => {
  const pending = await ins().get(`/api/v1/classes/${state.classId}/enrollments?status=pending`)
  const [enrollment] = (await pending.json()).items
  const approve = await ins().patch(`/api/v1/enrollments/${enrollment.id}`, {
    data: { action: 'approve' },
  })
  expect(approve.ok()).toBeTruthy()

  await page.reload()
  // Approved: the class is now a link in the class list on the left, and choosing it opens it.
  const classLink = page
    .getByRole('complementary', { name: 'Your classes' })
    .getByRole('link', { name: new RegExp(className) })
  await expect(classLink).toBeVisible()
  await classLink.click()

  await expect(page.getByRole('heading', { name: className, level: 1 })).toBeVisible()
  await expect(page.getByText('Laboratory is OPEN')).toBeVisible()
  const activity = page.getByRole('listitem').filter({ hasText: activityTitle })
  await expect(activity.getByText('No due date')).toBeVisible()
  await activity.getByText('Instructions', { exact: true }).click()
  await expect(activity.getByText('Make main.py greet the world')).toBeVisible()

  // Nothing handed in yet: no Submitted badge, and the overdue activity says it is closed.
  await expect(activity.getByText('Submitted', { exact: true })).toHaveCount(0)
  const overdue = page.getByRole('listitem').filter({ hasText: lateTitle })
  await expect(overdue.getByText('Past due')).toBeVisible()
})

// ------------------------------------------------------------------ workspace

test('4. "Open in workspace" shows the activity folder and opens main.py', async () => {
  await page.getByRole('link', { name: `Open ${activityTitle} in workspace` }).click()

  await expect(page.getByRole('treeitem', { name: new RegExp(`^${activityTitle}`) })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: /^helpers\.py/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /^main\.py/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('.cm-content')).toContainText('import helpers')
  await expect(page.getByText('Laboratory OPEN', { exact: true })).toBeVisible()
  await expect(page.getByText('All changes saved')).toBeVisible()

  // The quota bar and the run panel are there, and the whole IDE fits a 1366x768 screen.
  await expect(page.getByRole('progressbar', { name: 'Workspace storage used' })).toBeVisible()
  await page.getByRole('radio', { name: 'Use input list' }).click()
  await expect(page.getByLabel('Program input (one value per line, read by input())')).toBeVisible()
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth > window.innerWidth ||
      document.documentElement.scrollHeight > window.innerHeight,
  )
  expect(overflow, 'the page should not scroll at 1366x768').toBe(false)
})

test('5. typing autosaves after a pause, without making a version', async () => {
  await typeAtEnd('# autosaved line')
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await expect(page.getByRole('tab', { name: /^main\.py unsaved changes/ })).toBeVisible()
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })

  const saved = await serverFile(`${activityTitle}/main.py`)
  expect(saved.content).toContain('# autosaved line')

  const versions = await page.request.get(`/api/v1/workspace/files/${saved.id}/versions`)
  expect((await versions.json()).total).toBe(0)
})

test('6. Ctrl+S saves a version; History previews it and restores it as an unsaved change', async () => {
  await typeAtEnd('\n# keep this version')
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved (version created)')).toBeVisible()
  await expect(page.getByText('All changes saved')).toBeVisible()

  // Change the file again, then go back to the kept version.
  await typeAtEnd('\n# a later mistake')
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'History' }).click()
  const drawer = page.getByRole('dialog', { name: /History: / })
  await expect(drawer.getByRole('listitem')).toHaveCount(1)
  await expect(drawer.locator('.cm-content')).toContainText('# keep this version')
  await expect(drawer.locator('.cm-content')).not.toContainText('# a later mistake')
  await drawer.getByRole('button', { name: 'Restore this version' }).click()
  await expect(drawer).toBeHidden()

  // The restored text is in the editor as an unsaved change; the later mistake is gone from it.
  await expect(page.locator('.cm-content')).not.toContainText('# a later mistake')
  await expect(page.locator('.cm-content')).toContainText('# keep this version')
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  expect((await serverFile(`${activityTitle}/main.py`)).content).not.toContain('# a later mistake')
})

test('7. multi-file work saves: helpers.py is edited and both files are on the server', async () => {
  await page.getByRole('treeitem', { name: /^helpers\.py/ }).click()
  await expect(page.getByRole('tab', { name: /^helpers\.py/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await typeAtEnd('\n\ndef shout(name):\n    return greet(name).upper()')
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })

  const helpers = await serverFile(`${activityTitle}/helpers.py`)
  const main = await serverFile(`${activityTitle}/main.py`)
  expect(helpers.content).toContain('def shout(name)')
  expect(main.content).toContain('import helpers')
})

test('8. new file and folder: names are checked before sending; the new file opens', async () => {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New file' })
  // The selected file is in the activity folder, so new files go there.
  await expect(dialog.getByText(activityTitle)).toBeVisible()

  await dialog.getByLabel('File name').fill('run.exe')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog.getByText(/Use one of these file types/)).toBeVisible()

  await dialog.getByLabel('File name').fill('../escape.py')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog.getByText(/not allowed/)).toBeVisible()

  await dialog.getByLabel('File name').fill('HELPERS.py')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog.getByText(/already exists/)).toBeVisible()

  await dialog.getByLabel('File name').fill('notes.txt')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('tab', { name: /^notes\.txt/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect((await serverFile(`${activityTitle}/notes.txt`)).content).toBe('')

  // The top level holds only the activity folders: the menu on empty space below the files offers nothing.
  await page
    .getByRole('tree', { name: 'Files' })
    .locator('xpath=..')
    .click({ button: 'right', position: { x: 100, y: 300 } })
  await expect(
    page.getByRole('menuitem', { name: 'New folder (choose an activity folder)' }),
  ).toBeDisabled()
  await page.keyboard.press('Escape')

  // A folder inside the activity folder, from its right-click menu.
  await page
    .getByRole('treeitem', { name: new RegExp(`^${activityTitle}`) })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New folder' }).click()
  const folder = page.getByRole('dialog', { name: 'New folder' })
  await folder.getByLabel('Folder name').fill('practice')
  await folder.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('treeitem', { name: /^practice/ })).toBeVisible()
})

test('9. renaming a folder keeps its open tabs, and unsaved typing follows to the new path', async () => {
  // A file inside "practice", open in a tab.
  await page.getByRole('treeitem', { name: /^practice/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New file' }).click()
  const dialog = page.getByRole('dialog', { name: 'New file' })
  await dialog.getByLabel('File name').fill('drill.py')
  await dialog.getByRole('button', { name: 'Create' }).click()
  const tab = page.getByRole('tab', { name: /^drill\.py/ })
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(tab).toHaveAttribute('title', `${activityTitle}/practice/drill.py`)

  // Rename the folder and, straight away, type into the still-open file.
  await page.getByRole('treeitem', { name: /^practice/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename / move' }).click()
  const rename = page.getByRole('dialog', { name: 'Rename or move' })
  // Moving it to the top level is refused: it stays in the activity folder. (The box selects only the name
  // when it gets focus, so select the whole path first, as a person would.)
  await rename.getByLabel('New path').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('drills')
  await rename.getByRole('button', { name: 'Rename' }).click()
  await expect(rename.getByText(/go inside an activity folder/)).toBeVisible()
  await rename.getByLabel('New path').fill(`${activityTitle}/drills`)
  await rename.getByRole('button', { name: 'Rename' }).click()

  await expect(page.getByRole('treeitem', { name: /^drills/ })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: /^practice/ })).toHaveCount(0)
  await expect(tab).toHaveAttribute('title', `${activityTitle}/drills/drill.py`)
  await expect(tab).toHaveAttribute('aria-selected', 'true')

  await typeAtEnd('print("after rename")')
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  expect((await serverFile(`${activityTitle}/drills/drill.py`)).content).toContain('after rename')
})

test('10. deleting asks first and closes the tabs of what was deleted', async () => {
  await page.getByRole('treeitem', { name: /^drills/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete this folder?' })
  await expect(confirm.getByText(/everything inside it/)).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete' }).click()

  await expect(page.getByRole('treeitem', { name: /^drills/ })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /^drill\.py/ })).toHaveCount(0)
  expect((await serverEntries()).some((e) => e.path.startsWith(`${activityTitle}/drills`))).toBe(
    false,
  )
})

test('11. Ctrl+P finds a file by name', async () => {
  await page.keyboard.press('Control+p')
  const dialog = page.getByRole('dialog', { name: 'Open file' })
  await dialog.getByRole('combobox').fill('help')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: /^helpers\.py/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('12. a save conflict (409) lets the student pick the server copy or their own', async () => {
  await page.getByRole('tab', { name: /^notes\.txt/ }).click()
  const notes = await serverFile(`${activityTitle}/notes.txt`)

  // "Another window" saves notes.txt first.
  const other = await page.request.put(`/api/v1/workspace/files/${notes.id}`, {
    data: { content: 'from another window', last_updated_at: notes.updated_at },
  })
  expect(other.ok()).toBeTruthy()

  await typeAtEnd('my own words')
  const dialog = page.getByRole('dialog', { name: 'This file was changed somewhere else' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  // It must be answered: Escape does nothing.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Load latest from server' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.cm-content')).toContainText('from another window')
  await expect(page.locator('.cm-content')).not.toContainText('my own words')

  // Again, this time keeping the student's own version.
  const again = await serverFile(`${activityTitle}/notes.txt`)
  await page.request.put(`/api/v1/workspace/files/${again.id}`, {
    data: { content: 'someone else again', last_updated_at: again.updated_at },
  })
  await typeAtEnd(' plus mine')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByRole('button', { name: 'Keep my version' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  expect((await serverFile(`${activityTitle}/notes.txt`)).content).toContain(
    'from another window plus mine',
  )
})

test('13. submitting asks first, then shows the submitted time', async () => {
  await page.getByRole('tab', { name: /^main\.py/ }).click()
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: `Submit everything in '${activityTitle}'?` })
  await expect(confirm.getByText(/submit again/i)).toBeVisible()
  // Submitting refreshes the student's submission list (that is what updates the class home badge).
  const refreshed = page.waitForResponse(
    (r) => r.url().includes('/my-submissions') && r.request().method() === 'GET',
  )
  await confirm.getByRole('button', { name: 'Submit' }).click()
  await refreshed

  await expect(page.getByText(/Submitted .*(AM|PM)/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit again' })).toBeVisible()

  const list = await ins().get(`/api/v1/activities/${state.activityId}/submissions`)
  const items = (await list.json()).items as { student: { username: string }; file_count: number }[]
  const mine = items.find((s) => s.student.username === STUDENT)
  expect(mine?.file_count).toBeGreaterThanOrEqual(3)
})

test('14. when the instructor closes access, the workspace becomes read-only and says what was lost', async () => {
  // Typed a moment before the instructor closes access (the autosave has not run yet). The server
  // announces the closure over the live connection, the page makes one last save attempt, and the
  // server refuses it (403 LAB_CLOSED): the text must stay in the editor and the student be told.
  await page.getByRole('tab', { name: /^helpers\.py/ }).click()
  await typeAtEnd('\n# typed after access closed')
  expect((await ins().patch(`/api/v1/sessions/${state.sessionId}/close`)).ok()).toBeTruthy()

  await expect(
    page.getByText('Laboratory access is closed: your workspace is read-only.'),
  ).toBeVisible({
    timeout: 10_000,
  })
  await expect(
    page.getByText('Your last changes could not be saved because access was closed.'),
  ).toBeVisible()

  // The text is still there (kept in memory) and flagged as unsaved...
  await expect(page.locator('.cm-content')).toContainText('# typed after access closed')
  await expect(page.getByRole('tab', { name: /^helpers\.py unsaved changes/ })).toBeVisible()
  // ...but nothing can be changed any more.
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Folder', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  // Reading and submitting still work.
  await expect(page.getByRole('button', { name: 'Submit again' })).toBeEnabled()
  expect((await serverFile(`${activityTitle}/helpers.py`)).content).not.toContain(
    'typed after access closed',
  )

  // Writes really are refused by the server too.
  const helpers = await serverFile(`${activityTitle}/helpers.py`)
  const refused = await page.request.put(`/api/v1/workspace/files/${helpers.id}`, {
    data: { content: 'x', last_updated_at: helpers.updated_at },
  })
  expect(refused.status()).toBe(403)
})

test('15. when access opens again, the workspace unlocks and the kept text saves', async () => {
  expect((await ins().patch(`/api/v1/sessions/${state.sessionId}/open`)).ok()).toBeTruthy()
  // The page checks the lab every 15 seconds.
  await expect(page.getByText('Laboratory OPEN', { exact: true })).toBeVisible({ timeout: 25_000 })
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  expect((await serverFile(`${activityTitle}/helpers.py`)).content).toContain(
    'typed after access closed',
  )
})

test('16. the class home shows Submitted after a submit, with no reload', async () => {
  // Back to the class by the in-app link: a client-side navigation, not a page load.
  await page.getByRole('link', { name: className }).click()
  const card = page.getByRole('listitem').filter({ hasText: activityTitle })
  await expect(card.getByText('Submitted', { exact: true })).toBeVisible()
  await expect(card.getByText(/Handed in on /)).toBeVisible()
  await expect(card.getByText('Past due')).toHaveCount(0)
  // The other activity is still not handed in.
  const overdue = page.getByRole('listitem').filter({ hasText: lateTitle })
  await expect(overdue.getByText('Past due')).toBeVisible()
  await expect(overdue.getByText('Submitted', { exact: true })).toHaveCount(0)
})

test('17. past its deadline an activity is closed: read-only, no Submit, but it still runs', async () => {
  // The server refuses a submission after the due date (there are no late submissions).
  const refused = await page.request.post(`/api/v1/activities/${state.lateActivityId}/submit`)
  expect(refused.status()).toBe(403)
  expect((await refused.json()).code).toBe('ACTIVITY_PAST_DUE')

  await page.goto(`/my/classes/${state.classId}/workspace?activity=${state.lateActivityId}`)
  await expect(page.getByRole('tab', { name: /^main\.py/ })).toBeVisible()
  // The folder is locked in the tree, the editor is read-only and says why.
  await expect(
    page.getByRole('treeitem', { name: new RegExp(`^${lateTitle}`) }).getByRole('img', {
      name: 'read-only',
    }),
  ).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  await expect(page.getByText(/was due on .*: its folder is read-only/)).toBeVisible()
  // Submit is closed; Run still works.
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('log', { name: 'Program output' })).toContainText('late', {
    timeout: 30_000,
  })

  // The card on the class home says it is closed.
  await page.goto(`/my/classes/${state.classId}`)
  const overdue = page.getByRole('listitem').filter({ hasText: lateTitle })
  await expect(overdue.getByText('Past due: closed')).toBeVisible()
})

test('17b. starter files can be edited but not deleted, renamed or moved', async () => {
  await page.goto(`/my/classes/${state.classId}/workspace?activity=${state.activityId}`)
  await page
    .locator(`[role="treeitem"][title="${activityTitle}/main.py"]`)
    .click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: /^Delete \(starter file\)/ })).toBeDisabled()
  await expect(
    page.getByRole('menuitem', { name: /^Rename \/ move \(starter file\)/ }),
  ).toBeDisabled()
  await page.keyboard.press('Escape')

  const main = await serverFile(`${activityTitle}/main.py`)
  const refused = await page.request.delete(`/api/v1/workspace/files/${main.id}`)
  expect(refused.status()).toBe(403)
  expect((await refused.json()).code).toBe('STARTER_FILE_PROTECTED')
})

test('18. reopening the workspace remembers the submission (not just this tab)', async () => {
  await page.goto(`/my/classes/${state.classId}`)
  await page.getByRole('link', { name: `Open ${activityTitle} in workspace` }).click()
  await expect(page.getByRole('tab', { name: /^main\.py/ })).toBeVisible()
  await expect(page.getByText(/Submitted .*(AM|PM)/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit again' })).toBeVisible()
})
