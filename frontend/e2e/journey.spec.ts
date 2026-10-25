import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'
import { createRoom, manilaInput, roomName } from './lab'

/**
 * The whole course of a lab, start to finish, with real people in separate browsers and nothing
 * done behind the UI's back:
 *   1. the admin generates a registration code and the student signs up with it,
 *   2. the instructor makes a class and an invite code; that student joins, the instructor approves,
 *   3. the instructor opens a session and publishes an activity; the student sees the folder,
 *   4. the student edits, saves, runs (output appears) and submits,
 *   5. the instructor closes the session and the student's workspace is read-only,
 *   6. signing in a second time kicks the first.
 */

const run = Date.now().toString(36)
const JOURNEY_ROOM = roomName('Journey room')
const STUDENT_USERNAME = `journey.${run}`
const STUDENT_PASSWORD = 'Passw0rd-journey'
const CLASS_NAME = `Journey Class ${run}`
const TITLE = `Journey Lab ${run}`

let admin: Page
let ins: Page
let stu: Page
const ids = { classId: 0, activityId: 0 }
let code = ''

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  const open = async () =>
    (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  admin = await open()
  ins = await open()
  stu = await open()
})

test('1. the admin generates a code and the student signs up with it', async () => {
  const a = account('admin')
  await signIn(admin, a.username, a.password)
  await expect(admin.getByRole('heading', { name: 'Students', level: 1 })).toBeVisible()

  // Students make their own account with a registration code from the administrator.
  await admin.goto('/admin/registration-codes')
  await admin.getByRole('button', { name: 'Generate codes' }).first().click()
  const generate = admin.getByRole('dialog', { name: 'Generate registration codes' })
  await generate.getByRole('tab', { name: 'Single' }).click()
  await generate.getByLabel('Batch name').fill(`Journey ${run}`)
  await generate.getByRole('button', { name: 'Generate code' }).click()
  const result = admin.getByRole('dialog', { name: 'Your registration codes' })
  const code = (
    await result.getByRole('list', { name: 'Registration codes' }).getByRole('listitem').innerText()
  ).trim()
  await result.getByRole('button', { name: 'Done' }).click()

  await stu.goto('/signup')
  await stu.getByLabel('Registration code').fill(code)
  await stu.getByLabel('Student number').fill(`J-${run}`)
  await stu.getByLabel('Full name').fill('Journey Student')
  await stu.getByLabel('Username').fill(STUDENT_USERNAME)
  await stu.getByLabel('Password', { exact: true }).fill(STUDENT_PASSWORD)
  await stu.getByLabel('Confirm password').fill(STUDENT_PASSWORD)
  await stu.getByRole('button', { name: 'Create account' }).click()
  await expect(stu).toHaveURL(/\/my\/classes$/)
  // Signed in by the sign-up; step 2 signs in again the usual way.
  await stu.context().clearCookies()

  await admin.goto('/admin/users/students')
  await admin.getByLabel('Search').fill(STUDENT_USERNAME)
  await expect(admin.getByRole('row', { name: new RegExp(STUDENT_USERNAME) })).toBeVisible()
})

test('2. the instructor creates a class and a code; the student joins; the instructor approves', async () => {
  const i = account('instructor2')
  await signIn(ins, i.username, i.password)
  await ins.getByRole('button', { name: 'New class' }).click()
  const classDialog = ins.getByRole('dialog', { name: 'New class' })
  await classDialog.getByLabel('Class name').fill(CLASS_NAME)
  await classDialog.getByLabel('Year and section').fill('BSIT J-1')
  await classDialog.getByRole('button', { name: 'Create class' }).click()
  await expect(ins.getByRole('heading', { name: CLASS_NAME, level: 1 })).toBeVisible()
  ids.classId = Number(new URL(ins.url()).pathname.split('/')[2])

  await ins.getByRole('tab', { name: 'Invite codes' }).click()
  await ins.getByRole('button', { name: 'New invite code' }).click()
  const codeDialog = ins.getByRole('dialog', { name: 'New invite code' })
  await codeDialog.getByRole('button', { name: 'Create code' }).click()
  code = (await codeDialog.locator('span.font-mono').innerText()).trim()
  expect(code).toMatch(/^[A-Z0-9]{8}$/)
  await codeDialog.getByRole('button', { name: 'Done' }).click()

  // The student signs in with the account the admin made, and joins with the code.
  await signIn(stu, STUDENT_USERNAME, STUDENT_PASSWORD)
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  await stu.getByRole('button', { name: 'Join class' }).click()
  const join = stu.getByRole('dialog', { name: 'Join a class' })
  await join.getByLabel('Invite code').fill(code)
  await join.getByRole('button', { name: 'Join class' }).click()
  await expect(join.getByRole('status')).toContainText(`Request sent for ${CLASS_NAME}`)
  await join.getByRole('button', { name: 'Done' }).click()
  await expect(stu.getByText('Pending approval')).toBeVisible()

  // The instructor sees the request and approves it.
  await ins.reload()
  await ins.getByRole('tab', { name: 'Students' }).click()
  await expect(ins.getByRole('heading', { name: /Waiting for approval \(1\)/ })).toBeVisible()
  await ins.getByRole('button', { name: 'Approve Journey Student' }).click()
  await expect(ins.getByText('Journey Student was approved')).toBeVisible()

  // The student's list updates by itself (it refreshes every 20 s) or on reload.
  await stu.reload()
  // Approved: the class is now a link in the class list, and choosing it opens it.
  await stu
    .getByRole('complementary', { name: 'Your classes' })
    .getByRole('link', { name: new RegExp(CLASS_NAME) })
    .click()
  await expect(stu.getByRole('heading', { name: CLASS_NAME, level: 1 })).toBeVisible()
  await expect(stu.getByText('Laboratory access is closed — read-only')).toBeVisible()
})

test('3. the instructor opens a session and publishes; the student sees the folder', async () => {
  // Every session takes place in a lab: a room of this journey's own, made before the form opens.
  await createRoom(ins.request, JOURNEY_ROOM)
  await ins.getByRole('tab', { name: 'Sessions' }).click()
  await ins.getByRole('button', { name: 'Create the first session' }).click()
  const batch = ins.getByRole('dialog', { name: 'New lab session' })
  await batch.getByLabel('Session name').fill('Batch 1')
  // A few minutes ahead: one whose start has come opens by itself before the test presses Open.
  await batch.getByLabel('Starts').fill(manilaInput(10))
  await batch.getByLabel('Lab (room)').selectOption({ label: JOURNEY_ROOM })
  await batch.getByRole('button', { name: 'Create session' }).click()
  await expect(ins.getByText('Session created')).toBeVisible()
  await ins.getByRole('button', { name: 'OPEN ACCESS' }).click()
  await expect(ins.getByText('Laboratory is OPEN')).toBeVisible()
  // The student's class home is on screen: its banner flips by itself.
  await expect(stu.getByText('Laboratory is OPEN')).toBeVisible({ timeout: 5000 })

  await ins.getByRole('tab', { name: 'Activities' }).click()
  await ins.getByRole('link', { name: 'New activity' }).click()
  await ins.getByLabel('Title', { exact: true }).fill(TITLE)
  await ins.getByLabel('Instructions').fill('Print a greeting.')
  await ins.getByRole('button', { name: 'Add file' }).click()
  const add = ins.getByRole('dialog', { name: 'Add a starter file' })
  await add.getByLabel('File name').fill('main.py')
  await add.getByRole('button', { name: 'Add file' }).click()
  await ins.locator('.cm-content').click()
  await ins.keyboard.type("print('journey ok')")
  await ins.getByRole('button', { name: 'Save draft' }).click()
  await expect(ins.getByText('Draft saved')).toBeVisible()
  // The page moves to the saved activity a moment after the toast: wait for that before reading its id.
  await expect(ins).toHaveURL(/\/activities\/\d+$/)
  ids.activityId = Number(ins.url().split('/').pop())
  await ins.getByRole('button', { name: 'Publish…' }).click()
  await ins
    .getByRole('dialog', { name: 'Publish this activity?' })
    .getByRole('button', { name: 'Publish to students' })
    .click()
  await expect(ins.getByText(/Published\./)).toBeVisible()

  // The student, still on the class home, is told and sees the activity without reloading.
  await expect(stu.getByText(`New activity: ${TITLE}`)).toBeVisible({ timeout: 5000 })
  const card = stu.getByRole('listitem').filter({ hasText: TITLE })
  await expect(card).toBeVisible()
  await card.getByRole('link', { name: `Open ${TITLE} in workspace` }).click()
  await expect(stu.getByRole('treeitem', { name: new RegExp(`^${TITLE}`) })).toBeVisible()
  await expect(stu.getByRole('treeitem', { name: /^main\.py/ })).toBeVisible()
  await expect(stu.getByRole('tab', { name: /^main\.py/ })).toHaveAttribute('aria-selected', 'true')
})

test('4. the student edits, saves, runs and submits', async () => {
  await stu.locator('.cm-content').click()
  await stu.keyboard.press('Control+End')
  await stu.keyboard.type("\nprint('and this line is mine')")
  await expect(stu.getByText('All changes saved')).toBeVisible({ timeout: 10_000 }) // autosave
  await stu.keyboard.press('Control+s')
  await expect(stu.getByText('Saved (version created)')).toBeVisible()

  await stu.getByRole('button', { name: 'Run', exact: true }).click()
  const output = stu.getByRole('log', { name: 'Program output' })
  await expect(output).toContainText('journey ok', { timeout: 25_000 })
  await expect(output).toContainText('and this line is mine')
  await expect(stu.getByText(/Finished in \d+ ms \(exit 0\)/)).toBeVisible()

  await stu.getByRole('button', { name: 'Submit', exact: true }).click()
  await stu
    .getByRole('dialog', { name: `Submit everything in '${TITLE}'?` })
    .getByRole('button', { name: 'Submit' })
    .click()
  await expect(stu.getByText(/Submitted .*(AM|PM)/)).toBeVisible()

  // The instructor sees the work in the submissions list and opens the snapshot.
  await ins.goto(`/classes/${ids.classId}/activities/${ids.activityId}/submissions`)
  const row = ins.getByRole('row', { name: /Journey Student/ })
  await expect(row.getByText(/(AM|PM)/)).toBeVisible()
  await row.getByRole('link', { name: 'View work of Journey Student' }).click()
  await expect(ins.locator('.cm-content')).toContainText('and this line is mine')
})

test('5. the instructor closes the session and the student is read-only', async () => {
  await ins.goto(`/classes/${ids.classId}?tab=sessions`)
  await ins.getByRole('button', { name: 'CLOSE ACCESS' }).click()
  await ins
    .getByRole('dialog', { name: 'Close laboratory access?' })
    .getByRole('button', { name: 'Close access' })
    .click()
  await expect(ins.getByText('Laboratory is CLOSED')).toBeVisible()

  await expect(
    stu.getByText('Laboratory access is closed: your workspace is read-only.'),
  ).toBeVisible({ timeout: 4000 })
  await expect(stu.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  await expect(stu.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  await expect(stu.getByRole('button', { name: 'File', exact: true })).toBeDisabled()
})

test('6. signing in a second time kicks the first', async ({ browser }) => {
  const second = await (await browser.newContext()).newPage()
  await signIn(second, STUDENT_USERNAME, STUDENT_PASSWORD)
  await expect(second.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()

  // The first browser finds out as soon as it next talks to the server (here: it regains focus).
  await stu.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(stu).toHaveURL(/\/login$/)
  await expect(stu.getByText('You were signed in on another device')).toBeVisible()
  await second.reload()
  await expect(second.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
})
