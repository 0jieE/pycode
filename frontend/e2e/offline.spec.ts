import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'
import { approveAll, createLab, join, type Lab } from './lab'
import { watchOffline, type OfflineWatch } from './offline'

/**
 * The offline check: the app is walked through screen by screen as an admin, an instructor and a
 * student (login, user import, classes and every tab, activity editor, submissions, the live monitor,
 * the student viewer, the workspace with History, Run and Submit). Every request of all three
 * browsers is recorded, and the test fails if even one goes to a host other than the app's own.
 */

const run = Date.now().toString(36)
const STUDENT = 'student14'
const TITLE = `Offline ${run}`

let admin: Page
let ins: Page
let stu: Page
let lab: Lab
const watches: Record<string, OfflineWatch> = {}

async function signIn(page: Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(account(username).password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser, baseURL }) => {
  const open = async (name: string) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
    watches[name] = watchOffline(context, baseURL!)
    return context.newPage()
  }
  admin = await open('admin')
  ins = await open('instructor')
  stu = await open('student')
})

test('the guard really catches a request to another host (negative control)', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext()
  const watch = watchOffline(context, baseURL!)
  const page = await context.newPage()
  await page.goto('/login')
  // Nothing may leave for another host, so this only *attempts* it: the request event still fires.
  await page.evaluate(() =>
    fetch('https://example.com/pixel.gif', { mode: 'no-cors' }).catch(() => 0),
  )
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const ws = new WebSocket('wss://example.com/socket')
        ws.onerror = ws.onclose = () => resolve(0)
      }),
  )
  expect(watch.foreign.some((u) => u.startsWith('https://example.com/pixel.gif'))).toBe(true)
  expect(watch.foreign.some((u) => u.startsWith('wss://example.com'))).toBe(true)
  await context.close()
})

test('admin: login, users, create and import dialogs, registration codes', async () => {
  // The public sign-up page, before anyone is signed in.
  await admin.goto('/signup')
  await expect(admin.getByRole('heading', { name: 'Create your account', level: 1 })).toBeVisible()
  await signIn(admin, 'admin')
  await expect(admin.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible()
  await admin
    .getByRole('navigation', { name: 'Users list' })
    .getByRole('link', { name: /^Instructors/ })
    .click()
  await expect(admin.getByRole('row', { name: /instructor1/ })).toBeVisible()
  await admin.getByRole('button', { name: 'New user' }).click()
  await expect(admin.getByRole('dialog', { name: 'Create user' })).toBeVisible()
  await admin.keyboard.press('Escape')
  await admin.getByRole('button', { name: 'Import CSV' }).click()
  await expect(admin.getByRole('dialog', { name: 'Import students from CSV' })).toBeVisible()
  await admin.keyboard.press('Escape')

  // Registration codes: the page, the generate dialog (both tabs).
  await admin.getByRole('link', { name: 'Registration Codes' }).click()
  await expect(admin.getByRole('heading', { name: 'Registration codes', level: 1 })).toBeVisible()
  await admin.getByRole('button', { name: 'Generate codes' }).first().click()
  const generate = admin.getByRole('dialog', { name: 'Generate registration codes' })
  await generate.getByRole('tab', { name: 'Bulk' }).click()
  await expect(generate.getByLabel('Number of codes (1–200)')).toBeVisible()
  await admin.keyboard.press('Escape')

  await admin.getByRole('button', { name: 'Sign out' }).click()
  await expect(admin).toHaveURL(/\/login$/)
})

test('instructor: classes, every class tab, activity, submissions', async () => {
  await signIn(ins, 'instructor2')
  await expect(ins.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()
  lab = await createLab(ins.request, {
    name: `E2E Offline ${run}`,
    title: TITLE,
    files: [{ path: 'main.py', content: "print('offline ok')\n" }],
  })

  const student = await stu.context().request.post('/api/v1/auth/login', {
    data: { username: STUDENT, password: account(STUDENT).password },
  })
  expect(student.ok()).toBeTruthy()
  await join(stu.request, lab)
  await approveAll(ins.request, lab)

  await ins.goto(`/classes/${lab.classId}`)
  for (const tab of ['Students', 'Invite codes', 'Sessions', 'Activities']) {
    await ins.getByRole('tab', { name: tab }).click()
    await expect(ins.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
  }
  await ins.getByRole('link', { name: `View ${TITLE}` }).click()
  await expect(ins.getByLabel('Title', { exact: true })).toHaveValue(TITLE)
  await expect(ins.locator('.cm-content')).toContainText('offline ok') // CodeMirror loaded locally
  await ins.goto(`/classes/${lab.classId}/activities/${lab.activityId}/submissions`)
  await expect(ins.getByRole('heading', { name: `Submissions: ${TITLE}` })).toBeVisible()
})

test('student: class home, workspace, save, history, quick open, run, submit', async () => {
  await stu.goto('/my/classes')
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  await stu
    .getByRole('complementary', { name: 'Your classes' })
    .getByRole('link', { name: new RegExp(`E2E Offline ${run}`) })
    .click()
  await expect(stu.getByText('Laboratory is OPEN')).toBeVisible()
  await stu.getByRole('link', { name: `Open ${TITLE} in workspace` }).click()
  await expect(stu.getByRole('tab', { name: /^main\.py/ })).toBeVisible()

  await stu.locator('.cm-content').click()
  await stu.keyboard.press('Control+End')
  await stu.keyboard.type("print('edited')")
  await stu.keyboard.press('Control+s')
  await expect(stu.getByText('Saved (version created)')).toBeVisible()

  await stu.getByRole('button', { name: 'History' }).click()
  await expect(stu.getByRole('dialog', { name: /History: / })).toBeVisible()
  await stu.keyboard.press('Escape')

  await stu.keyboard.press('Control+p')
  await expect(stu.getByRole('dialog', { name: 'Open file' })).toBeVisible()
  await stu.keyboard.press('Escape')

  await stu.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(stu.getByRole('log', { name: 'Program output' })).toContainText('offline ok', {
    timeout: 25_000,
  })
  await stu.getByRole('button', { name: 'Submit', exact: true }).click()
  await stu
    .getByRole('dialog', { name: `Submit everything in '${TITLE}'?` })
    .getByRole('button', { name: 'Submit' })
    .click()
  await expect(stu.getByText(/Submitted .*(AM|PM)/)).toBeVisible()
})

test('instructor: live monitor and the student viewer, with the student online', async () => {
  await ins.goto(`/classes/${lab.classId}/sessions/${lab.sessionId}/monitor`)
  await expect(ins.getByRole('heading', { name: 'Live monitor', level: 1 })).toBeVisible()
  await expect(ins.getByText('Live', { exact: true })).toBeVisible()
  await expect(ins.getByRole('row', { name: /Student 14/ }).getByText('Online')).toBeAttached()
  await ins
    .getByRole('link', { name: /View the workspace of Student 14/ })
    .first()
    .click()
  await expect(ins.getByText('Read-only', { exact: true })).toBeVisible()
  await expect(ins.locator('.cm-content')).toContainText('offline ok')
})

test('nothing, anywhere, went to another host', async () => {
  for (const [who, watch] of Object.entries(watches)) {
    expect(watch.seen(), `the ${who} browser was recorded`).toBeGreaterThan(15)
    expect(watch.foreign, `requests from the ${who} browser to other hosts`).toEqual([])
  }
})
