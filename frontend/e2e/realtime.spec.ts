import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'
import { approveAll, createLab, join, type Lab } from './lab'

/**
 * Everything live, with two real browsers: an instructor and a student.
 *  - closing/opening the lab flips the student's workspace within moments,
 *  - publishing an activity shows up without a reload,
 *  - the monitor updates by itself while the student works,
 *  - the instructor can read (not change) the student's files, and sees new work arrive.
 * An account can only be signed in once, so the instructor's API calls use the instructor's own
 * browser page (`ins.request` shares its cookie).
 */

const run = Date.now().toString(36)
const STUDENT = 'student12'
const IDLE_STUDENT = 'student13' // joins and is approved, but never opens a page: stays offline
const TITLE = `Live ${run}`

const FILES = [
  { path: 'main.py', content: "print('hello from main')\n" },
  { path: 'boom.py', content: 'print(1 / 0)\n' },
]

let ins: Page
let stu: Page
let lab: Lab

const TOTALS = (p: Page) => p.getByRole('region', { name: 'Totals' })
const row = (p: Page, name: string) => p.getByRole('row', { name: new RegExp(name) })
const studentEditor = () => stu.locator('.cm-content')

async function signIn(page: Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(account(username).password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  ins = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await signIn(ins, 'instructor1')
  await expect(ins.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()
  lab = await createLab(ins.request, { name: `E2E Live ${run}`, title: TITLE, files: FILES })

  // The idle student: joined and approved through the API, never in a browser.
  const idle = await playwright.request.newContext({ baseURL })
  await idle.post('/api/v1/auth/login', {
    data: { username: IDLE_STUDENT, password: account(IDLE_STUDENT).password },
  })
  await join(idle, lab)
  await idle.dispose()

  stu = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await signIn(stu, STUDENT)
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  await join(stu.request, lab)
  expect(await approveAll(ins.request, lab)).toBe(2)

  await stu.goto(`/my/classes/${lab.classId}/workspace?activity=${lab.activityId}`)
  await expect(stu.getByRole('tab', { name: /^main\.py/ })).toBeVisible()
  await expect(studentEditor()).toHaveAttribute('contenteditable', 'true')
})

test('1. closing the laboratory makes an open workspace read-only within moments', async () => {
  // Typed a moment ago, not yet autosaved: the page tries one last save when access closes.
  await studentEditor().click()
  await stu.keyboard.press('Control+End')
  await stu.keyboard.type('# typed just before closing')

  const started = Date.now()
  expect((await ins.request.patch(`/api/v1/sessions/${lab.sessionId}/close`)).ok()).toBeTruthy()

  await expect(
    stu.getByText('Laboratory access is closed: your workspace is read-only.'),
  ).toBeVisible({ timeout: 3000 })
  const elapsed = Date.now() - started
  expect(elapsed, `took ${elapsed} ms (polling alone would take up to 15 s)`).toBeLessThan(2500)

  await expect(studentEditor()).toHaveAttribute('contenteditable', 'false')
  await expect(stu.getByRole('button', { name: 'File', exact: true })).toBeDisabled()
  await expect(stu.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  // The last-chance save was refused by the server, and the student is told.
  await expect(
    stu.getByText('Your last changes could not be saved because access was closed.'),
  ).toBeVisible()
  await expect(studentEditor()).toContainText('# typed just before closing')
})

test('2. opening it again unlocks the workspace and the kept text is saved', async () => {
  const started = Date.now()
  expect((await ins.request.patch(`/api/v1/sessions/${lab.sessionId}/open`)).ok()).toBeTruthy()

  await expect(studentEditor()).toHaveAttribute('contenteditable', 'true', { timeout: 3000 })
  expect(Date.now() - started).toBeLessThan(2500)
  await expect(stu.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })

  const tree = await (await stu.request.get(`/api/v1/workspace/${lab.classId}/tree`)).json()
  const main = tree.entries.find((e: { path: string }) => e.path === `${TITLE}/main.py`)
  const file = await (await stu.request.get(`/api/v1/workspace/files/${main.id}`)).json()
  expect(file.content).toContain('# typed just before closing')
})

test('3. a newly published activity appears with a message, without reloading', async () => {
  const title = `Second ${run}`
  const created = await ins.request.post(`/api/v1/classes/${lab.classId}/activities`, {
    data: { title, starter_files: [{ path: 'start.py', content: 'print(2)\n' }] },
  })
  expect(created.ok()).toBeTruthy()
  const id = (await created.json()).id
  expect((await ins.request.post(`/api/v1/activities/${id}/publish`)).ok()).toBeTruthy()

  await expect(stu.getByText(`New activity: ${title}`)).toBeVisible({ timeout: 4000 })
  await expect(stu.getByRole('treeitem', { name: new RegExp(`^${title}`) })).toBeVisible()
})

// -------------------------------------------------------------------- monitor

test('4. the monitor lists everyone: who is online and who is not', async () => {
  await ins.goto(`/classes/${lab.classId}/sessions/${lab.sessionId}/monitor`)
  await expect(ins.getByRole('heading', { name: 'Live monitor', level: 1 })).toBeVisible()
  await expect(ins.getByText('Live', { exact: true })).toBeVisible() // the socket is connected

  await expect(row(ins, 'Student 12')).toBeVisible()
  await expect(row(ins, 'Student 13')).toBeVisible()
  await expect(row(ins, 'Student 12').getByText('Online')).toBeAttached()
  await expect(row(ins, 'Student 13').getByText('Offline')).toBeAttached()
  await expect(TOTALS(ins)).toContainText('1 of 2')
  await expect(row(ins, 'Student 12').getByText('Not run yet')).toBeVisible()
})

test('5. a save shows up on the monitor by itself, without reloading anything', async ({
  playwright,
  baseURL,
}) => {
  // Student 13 has never saved: their "last save" starts as a dash. They save through the API
  // (a student's API call is the same event as a click in the editor).
  const cell = row(ins, 'Student 13').getByRole('cell').nth(4)
  await expect(cell).toHaveText('—')

  let snapshotReloads = 0
  ins.on('request', (req) => {
    if (/\/sessions\/\d+\/monitor$/.test(req.url())) snapshotReloads++
  })

  const idle = await playwright.request.newContext({ baseURL })
  await idle.post('/api/v1/auth/login', {
    data: { username: IDLE_STUDENT, password: account(IDLE_STUDENT).password },
  })
  const tree = await (await idle.get(`/api/v1/workspace/${lab.classId}/tree`)).json()
  const main = tree.entries.find((e: { path: string }) => e.path === `${TITLE}/main.py`)
  const file = await (await idle.get(`/api/v1/workspace/files/${main.id}`)).json()
  const saved = await idle.put(`/api/v1/workspace/files/${main.id}`, {
    data: {
      content: `${file.content}# saved by student 13
`,
      last_updated_at: file.updated_at,
    },
  })
  expect(saved.ok()).toBeTruthy()
  await idle.dispose()

  await expect(cell).toHaveText(/just now|min ago/, { timeout: 5000 })
  expect(snapshotReloads, 'the cell changed from the live event, not from a reload').toBe(0)

  // Student 12 typing in the editor reaches the monitor the same way.
  await studentEditor().click()
  await stu.keyboard.press('Control+End')
  await stu.keyboard.type('\n# monitored save')
  await expect(stu.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  await expect(row(ins, 'Student 12').getByRole('cell').nth(4)).toHaveText(/just now|min ago/)
})

test('6. running code shows the result on the monitor', async () => {
  await stu.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(stu.getByText(/Finished in \d+ ms/)).toBeVisible({ timeout: 25_000 })

  const cell = row(ins, 'Student 12').getByRole('cell').nth(2)
  await expect(cell).toContainText('OK', { timeout: 5000 })
  await expect(cell).toContainText('main.py')
  await expect(TOTALS(ins)).toContainText('Ran code')
  await expect(TOTALS(ins).getByText('1', { exact: true }).first()).toBeVisible()
})

test('7. a crash lands under "Has errors"; "Not submitted" and "Offline" filter the list', async () => {
  await stu.getByRole('treeitem', { name: /^boom\.py/ }).click()
  await stu.waitForTimeout(3300) // the 3-second cooldown between runs
  await stu.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(stu.getByText('Exited with code 1')).toBeVisible({ timeout: 25_000 })

  await expect(row(ins, 'Student 12').getByRole('cell').nth(2)).toContainText('Error', {
    timeout: 5000,
  })

  await ins.getByRole('button', { name: /^Has errors/ }).click()
  await expect(row(ins, 'Student 12')).toBeVisible()
  await expect(row(ins, 'Student 13')).toHaveCount(0)

  await ins.getByRole('button', { name: /^Offline/ }).click()
  await expect(row(ins, 'Student 13')).toBeVisible()
  await expect(row(ins, 'Student 12')).toHaveCount(0)

  await ins.getByRole('button', { name: /^Not submitted/ }).click()
  await expect(row(ins, 'Student 12')).toBeVisible()
  await expect(row(ins, 'Student 13')).toBeVisible()
  await ins.getByRole('button', { name: /^All/ }).click()
})

test('8. a submission ticks the box and updates the count', async () => {
  await stu.getByRole('button', { name: 'Submit', exact: true }).click()
  await stu
    .getByRole('dialog', { name: `Submit everything in '${TITLE}'?` })
    .getByRole('button', { name: 'Submit' })
    .click()
  await expect(stu.getByText(/Submitted .*(AM|PM)/)).toBeVisible()

  await expect(row(ins, 'Student 12').getByText('Submitted')).toBeAttached({ timeout: 5000 })
  await expect(TOTALS(ins)).toContainText('Submitted')
  await ins.getByRole('button', { name: /^Not submitted/ }).click()
  await expect(row(ins, 'Student 12')).toHaveCount(0)
  await expect(row(ins, 'Student 13')).toBeVisible()
  await ins.getByRole('button', { name: /^All/ }).click()
})

// ----------------------------------------------- the instructor's read-only view

test('9. clicking a student opens their workspace, read-only, and new work shows up', async () => {
  await row(ins, 'Student 12').getByRole('cell').first().click() // the whole row is clickable
  await expect(ins).toHaveURL(/\/students\/\d+\/workspace$/)
  await expect(ins.getByRole('heading', { name: 'Student 12', level: 1 })).toBeVisible()
  await expect(ins.getByText('Read-only', { exact: true })).toBeVisible()
  await expect(ins.getByRole('treeitem', { name: /^main\.py/ })).toBeVisible()

  const viewer = ins.locator('.cm-content')
  // It opens on the first .py file (alphabetically boom.py); pick the one we want to read.
  await expect(viewer).toContainText('print(1 / 0)')
  await ins.getByRole('treeitem', { name: /^main\.py/ }).click()
  await expect(viewer).toContainText('hello from main')
  await expect(viewer).toHaveAttribute('contenteditable', 'false')
  await viewer.click()
  await ins.keyboard.type('HACKED')
  await expect(viewer).not.toContainText('HACKED')

  // The student keeps working: the instructor's view picks it up within the refresh interval.
  await stu.getByRole('treeitem', { name: /^main\.py/ }).click()
  await studentEditor().click()
  await stu.keyboard.press('Control+End')
  await stu.keyboard.type('\n# visible to the instructor')
  await expect(stu.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  await expect(viewer).toContainText('# visible to the instructor', { timeout: 9000 })

  // Back goes to where the instructor came from: the monitor.
  await ins.getByRole('banner').getByRole('link', { name: 'Live monitor' }).click()
  await expect(ins.getByRole('heading', { name: 'Live monitor', level: 1 })).toBeVisible()
})

test('10. a student who leaves the page shows as offline right away', async () => {
  await expect(row(ins, 'Student 12').getByText('Online')).toBeAttached()
  await stu.goto('/my/classes') // the class pages (and their socket) are gone
  await expect(row(ins, 'Student 12').getByText('Offline')).toBeAttached({ timeout: 6000 })
  await expect(TOTALS(ins)).toContainText('0 of 2')
})

test('11. signing in somewhere else sends the student back to the login page', async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(60_000)
  await stu.goto(`/my/classes/${lab.classId}`)
  await expect(
    stu
      .getByRole('heading', { name: 'Laboratory is OPEN' })
      .or(stu.getByText('Laboratory is OPEN')),
  ).toBeVisible()

  const elsewhere = await playwright.request.newContext({ baseURL })
  const res = await elsewhere.post('/api/v1/auth/login', {
    data: { username: STUDENT, password: account(STUDENT).password },
  })
  expect(res.ok()).toBeTruthy()

  // The open connection is re-checked every 20 s and the lab status every 15 s: either ends the session.
  await expect(stu).toHaveURL(/\/login$/, { timeout: 30_000 })
  await expect(stu.getByText('You were signed in on another device')).toBeVisible()
  await elsewhere.dispose()
})
