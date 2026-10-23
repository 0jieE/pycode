import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test'
import { account } from './accounts'
import { createRoom, manilaInput, roomName } from './lab'

/**
 * The Phase 3 flow, start to finish. The instructor side is driven through the real UI. The student
 * screens arrive in Phase 4, so the student's side (join, read the tree, submit) uses the API.
 */

const run = Date.now().toString(36)
const className = `E2E Class ${run}`
const activityTitle = `Lab ${run}`

const ROOM_A = roomName('Room A')
const ROOM_B = roomName('Room B')

const state = {
  classId: 0,
  activityId: 0,
  code: '',
  students: [] as { username: string; fullName: string; api: APIRequestContext }[],
}

async function signIn(page: Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(account(username).password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  page = await (await browser.newContext()).newPage()
  await signIn(page, 'instructor1')
  await expect(page.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()
  // Every session takes place in a lab; one room per batch (a room is never booked twice at once).
  await createRoom(page.request, ROOM_A)
  await createRoom(page.request, ROOM_B)

  // Two students with their own API sessions (student03 and student04 are not used by other specs).
  for (const username of ['student03', 'student04']) {
    const api = await playwright.request.newContext({ baseURL })
    const res = await api.post('/api/v1/auth/login', {
      data: { username, password: account(username).password },
    })
    expect(res.ok()).toBeTruthy()
    state.students.push({ username, fullName: (await res.json()).full_name, api })
  }
})

test.afterAll(async () => {
  await Promise.all(state.students.map((s) => s.api.dispose()))
})

test('1. instructor creates a class', async () => {
  await page.getByRole('button', { name: 'New class' }).click()
  const dialog = page.getByRole('dialog', { name: 'New class' })
  await dialog.getByLabel('Class name').fill(className)
  await dialog.getByLabel('Year and section').fill('BSIT 9-Z')
  await dialog.getByRole('button', { name: 'Create class' }).click()

  await expect(page.getByRole('heading', { name: className, level: 1 })).toBeVisible()
  state.classId = Number(new URL(page.url()).pathname.split('/')[2])
  expect(state.classId).toBeGreaterThan(0)
})

test('2. instructor creates an invite code', async () => {
  await page.getByRole('tab', { name: 'Invite codes' }).click()
  await page.getByRole('button', { name: 'New invite code' }).click()
  const dialog = page.getByRole('dialog', { name: 'New invite code' })
  await dialog.getByRole('button', { name: 'Create code' }).click()

  state.code = (await dialog.locator('span.font-mono').innerText()).trim()
  expect(state.code).toMatch(/^[A-Z0-9]{8}$/)
  await dialog.getByRole('button', { name: 'Done' }).click()

  const row = page.getByRole('row', { name: new RegExp(state.code) })
  await expect(row.getByText('Active', { exact: true })).toBeVisible()
  await expect(row.getByText('0 / ∞')).toBeVisible()
})

test('3. students join with the code and wait for approval', async () => {
  for (const s of state.students) {
    const res = await s.api.post('/api/v1/enroll', { data: { code: state.code } })
    expect(res.status()).toBe(201)
    expect((await res.json()).status).toBe('pending')
  }
  await page.reload()
  await page.getByRole('tab', { name: 'Students' }).click()
  await expect(page.getByRole('heading', { name: /Waiting for approval \(2\)/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Students/ })).toContainText('2')
})

test('4. instructor approves one, then approves the rest', async () => {
  const [first, second] = state.students
  await page.getByRole('button', { name: `Approve ${first!.fullName}` }).click()
  await expect(page.getByText(`${first!.fullName} was approved`)).toBeVisible()
  await expect(page.getByRole('heading', { name: /Waiting for approval \(1\)/ })).toBeVisible()

  await page.getByRole('button', { name: `Reject ${second!.fullName}` }).click()
  await expect(page.getByText(`${second!.fullName} was rejected`)).toBeVisible()
  await expect(page.getByRole('heading', { name: /Waiting for approval \(0\)/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Students in this class \(1\)/ })).toBeVisible()
})

test('4b. a rejected student cannot be un-rejected by joining again, and "approve all" works on a fresh batch', async ({
  baseURL,
}) => {
  // Re-joining returns the existing (rejected) row: no new request appears.
  const second = state.students[1]!
  const again = await second.api.post('/api/v1/enroll', { data: { code: state.code } })
  expect(again.status()).toBe(200)
  expect((await again.json()).status).toBe('rejected')

  // Two more students join, so "Approve all" has something to do.
  for (const username of ['student05', 'student06']) {
    const api = await request.newContext({
      baseURL,
    })
    const login = await api.post('/api/v1/auth/login', {
      data: { username, password: account(username).password },
    })
    state.students.push({ username, fullName: (await login.json()).full_name, api })
    const res = await api.post('/api/v1/enroll', { data: { code: state.code } })
    expect(res.status()).toBe(201)
  }
  await page.reload()
  await expect(page.getByRole('heading', { name: /Waiting for approval \(2\)/ })).toBeVisible()
  await page.getByRole('button', { name: 'Approve all 2' }).click()
  await expect(page.getByText('Approved 2 students')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Students in this class \(3\)/ })).toBeVisible()
})

test('5. instructor opens a session; a second one cannot be opened at the same time', async () => {
  await page.getByRole('tab', { name: 'Sessions' }).click()
  await expect(page.getByText('Laboratory is CLOSED')).toBeVisible()

  await page.getByRole('button', { name: 'Create the first session' }).click()
  let dialog = page.getByRole('dialog', { name: 'New lab session' })
  await dialog.getByLabel('Session name').fill('Batch 1')
  // A few minutes ahead: one whose start has come opens by itself before the test presses Open.
  await dialog.getByLabel('Starts').fill(manilaInput(10))
  // The lab is required.
  await dialog.getByRole('button', { name: 'Create session' }).click()
  await expect(dialog.getByText(/Choose the lab/)).toBeVisible()
  await dialog.getByLabel('Lab (room)').selectOption({ label: ROOM_A })
  await dialog.getByRole('button', { name: 'Create session' }).click()
  await expect(page.getByText('Session created')).toBeVisible()

  await page.getByRole('button', { name: 'OPEN ACCESS' }).click()
  await expect(page.getByText('Laboratory is OPEN')).toBeVisible()
  await expect(page.getByText('Laboratory OPEN', { exact: true })).toBeVisible() // header badge

  // A second session cannot be opened while the first is open: the backend's message is shown.
  await page.getByRole('button', { name: 'New session' }).click()
  dialog = page.getByRole('dialog', { name: 'New lab session' })
  await dialog.getByLabel('Session name').fill('Batch 2')
  await dialog.getByLabel('Starts').fill(manilaInput(10))
  // The same room at the same time is refused, naming who has it.
  await dialog.getByLabel('Lab (room)').selectOption({ label: ROOM_A })
  await dialog.getByRole('button', { name: 'Create session' }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: /is booked/ })).toBeVisible()
  await dialog.getByLabel('Lab (room)').selectOption({ label: ROOM_B })
  await dialog.getByRole('button', { name: 'Create session' }).click()
  await expect(page.getByRole('row', { name: /Batch 2/ })).toBeVisible()
  await page.getByRole('button', { name: 'Open Batch 2' }).click()
  await expect(page.getByRole('alert').filter({ hasText: /already open/ })).toBeVisible()
})

test('6. instructor writes an activity with a starter file and publishes it', async () => {
  await page.getByRole('tab', { name: 'Activities' }).click()
  await page.getByRole('link', { name: 'New activity' }).click()

  await page.getByLabel('Title', { exact: true }).fill(activityTitle)
  await page.getByLabel('Instructions').fill('Print a greeting.')

  await page.getByRole('button', { name: 'Add file' }).click()
  const add = page.getByRole('dialog', { name: 'Add a starter file' })
  await add.getByLabel('File name').fill('../evil.py')
  await add.getByRole('button', { name: 'Add file' }).click()
  await expect(add.getByText(/not allowed/)).toBeVisible()
  await add.getByLabel('File name').fill('main.py')
  await add.getByRole('button', { name: 'Add file' }).click()

  await page.locator('.cm-content').click()
  await page.keyboard.type("print('hello from starter')")

  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByText('Draft saved')).toBeVisible()
  await expect(page).toHaveURL(/\/activities\/\d+$/)
  state.activityId = Number(page.url().split('/').pop())

  await page.getByRole('button', { name: 'Publish…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Publish this activity?' })
  await expect(
    confirm.getByText("Title and starter files can't change after publishing."),
  ).toBeVisible()
  await expect(confirm.getByText(/3 approved students/)).toBeVisible()
  await confirm.getByRole('button', { name: 'Publish to students' }).click()

  await expect(page.getByText(/Published\./)).toBeVisible()
  await expect(page.getByText(/title and starter files are locked/i)).toBeVisible()
  await expect(page.getByLabel('Title', { exact: true })).toBeDisabled()
})

test('7. the activity folder appears in every approved student’s tree', async () => {
  for (const s of state.students.filter((x) => x.username !== 'student04')) {
    const res = await s.api.get(`/api/v1/workspace/${state.classId}/tree`)
    expect(res.ok()).toBeTruthy()
    const paths: string[] = (await res.json()).entries.map((e: { path: string }) => e.path)
    expect(paths).toContain(activityTitle)
    expect(paths).toContain(`${activityTitle}/main.py`)
  }
})

test('8. submissions: the submitted list, not-yet-submitted list and the snapshot viewer', async () => {
  const submitter = state.students[0]!
  const res = await submitter.api.post(`/api/v1/activities/${state.activityId}/submit`)
  expect(res.ok()).toBeTruthy()

  await page.goto(`/classes/${state.classId}/activities/${state.activityId}/submissions`)
  await expect(page.getByRole('heading', { name: `Submissions: ${activityTitle}` })).toBeVisible()
  await expect(page.getByText('1 of 3')).toBeVisible()
  const row = page.getByRole('row', { name: new RegExp(submitter.fullName) })
  await expect(row.getByText(/(AM|PM)/)).toBeVisible()
  await expect(row.getByText('Late')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /Not yet submitted \(2\)/ })).toBeVisible()

  await page.getByRole('link', { name: `View work of ${submitter.fullName}` }).click()
  await expect(page.getByText('Read-only snapshot')).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText("print('hello from starter')")
  // Read-only: typing does nothing.
  await page.locator('.cm-content').click()
  await page.keyboard.type('HACKED')
  await expect(page.locator('.cm-content')).not.toContainText('HACKED')
})

test('9. invite code: switch off blocks joining, expiry window and "used up" show in the badge', async ({
  baseURL,
}) => {
  await page.goto(`/classes/${state.classId}?tab=codes`)
  const row = page.getByRole('row', { name: new RegExp(state.code) })
  await expect(row.getByText('Active', { exact: true })).toBeVisible()

  await row.getByRole('switch').click()
  await expect(row.getByText('Disabled')).toBeVisible()
  // A student who never joined cannot use the switched-off code.
  const outsider = await request.newContext({
    baseURL,
  })
  await outsider.post('/api/v1/auth/login', {
    data: { username: 'student07', password: account('student07').password },
  })
  const denied = await outsider.post('/api/v1/enroll', { data: { code: state.code } })
  expect(denied.status()).toBe(400)
  expect((await denied.json()).code).toBe('CODE_INACTIVE')
  await outsider.dispose()

  await row.getByRole('switch').click()
  await expect(row.getByText('Active', { exact: true })).toBeVisible()

  // Limit the code to 1 use: 4 students already used it, so it reads "Used up".
  await row.getByRole('button', { name: /Edit the window of code/ }).click()
  const dialog = page.getByRole('dialog', { name: `Edit code ${state.code}` })
  await dialog.getByLabel('Maximum uses (optional)').fill('1')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(row.getByText('Used up')).toBeVisible()

  // An end before the start is caught in the form.
  await row.getByRole('button', { name: /Edit the window of code/ }).click()
  const again = page.getByRole('dialog', { name: `Edit code ${state.code}` })
  await again.getByLabel('Works until').fill('2000-01-01T00:00')
  await again.getByRole('button', { name: 'Save changes' }).click()
  await expect(again.getByText('The end must be after the start.')).toBeVisible()
  await again.getByRole('button', { name: 'Cancel' }).click()

  // Clearing the limit again (null) makes it Active.
  await row.getByRole('button', { name: /Edit the window of code/ }).click()
  const clear = page.getByRole('dialog', { name: `Edit code ${state.code}` })
  await clear.getByLabel('Maximum uses (optional)').fill('')
  await clear.getByRole('button', { name: 'Save changes' }).click()
  await expect(row.getByText('Active', { exact: true })).toBeVisible()
  await expect(row.getByText('∞')).toBeVisible()
})

test('10. instructor closes access', async () => {
  await page.goto(`/classes/${state.classId}?tab=sessions`)
  await page.getByRole('button', { name: 'CLOSE ACCESS' }).click()
  await page
    .getByRole('dialog', { name: 'Close laboratory access?' })
    .getByRole('button', { name: 'Close access' })
    .click()
  await expect(page.getByText('Laboratory is CLOSED')).toBeVisible()
})

test('11. other instructors cannot see this class, and archived classes leave the list', async ({
  browser,
}) => {
  const other = await (await browser.newContext()).newPage()
  await signIn(other, 'instructor2')
  await expect(other.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()
  await other.goto(`/classes/${state.classId}`)
  await expect(other.getByText('Class not found')).toBeVisible()

  // Archive from the class's own page; it then leaves the class list on the left, unless archived classes
  // are shown.
  await page.goto(`/classes/${state.classId}`)
  await page.getByRole('button', { name: `Archive ${className}` }).click()
  await page
    .getByRole('dialog', { name: 'Archive this class?' })
    .getByRole('button', { name: 'Archive' })
    .click()
  await expect(page.getByText(`${className} was archived`)).toBeVisible()
  const list = page.getByRole('complementary', { name: 'Your classes' })
  await expect(list.getByRole('link', { name: new RegExp(className) })).toHaveCount(0)

  await list.getByRole('button', { name: 'Show archived' }).click()
  await expect(list.getByRole('link', { name: new RegExp(className) })).toContainText('Archived')
  await page.getByRole('button', { name: `Restore ${className}` }).click()
  await expect(page.getByText(`${className} is active again`)).toBeVisible()
})
