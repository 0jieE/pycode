import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'
import { approveAll, createLab, join, type Lab } from './lab'

/**
 * When students start: the backend records the first time a student reaches their workspace while the session
 * is open (the client sends nothing), and the instructor's Session view shows it live.
 */

const run = Date.now().toString(36)
const STUDENT = 'student23'
const TITLE = `Started ${run}`

let ins: Page
let stu: Page
let lab: Lab

async function signIn(page: Page, username: string) {
  const a = account(username)
  await page.goto('/login')
  await page.getByLabel('Username').fill(a.username)
  await page.getByLabel('Password').fill(a.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

const row = () => ins.getByRole('row', { name: /Student 23/ })
const notStarted = () => ins.getByRole('button', { name: /^Not started/ })
const TIME = /\d{1,2}:\d{2}\s?[AP]M/

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  const open = async () =>
    (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  ins = await open()
  stu = await open()
  await signIn(ins, 'instructor2')
  await expect(ins.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()
  lab = await createLab(ins.request, {
    name: `E2E Started ${run}`,
    title: TITLE,
    files: [{ path: 'main.py', content: "print('hi')\n" }],
  })
  await signIn(stu, STUDENT)
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  await join(stu.request, lab)
  expect(await approveAll(ins.request, lab)).toBe(1)
})

test.afterAll(async () => {
  // No running session and no room left behind.
  await ins.request.patch(`/api/v1/sessions/${lab.sessionId}/close`)
  await ins.request.patch(`/api/v1/sessions/${lab.sessionId}`, {
    data: { ends_at: new Date().toISOString() },
  })
  await ins.request.delete(`/api/v1/labs/${lab.roomId}`)
})

test('1. before the student opens the workspace: Not started', async () => {
  await ins.goto(`/classes/${lab.classId}/sessions/${lab.sessionId}/monitor`)
  await expect(ins.getByRole('heading', { name: 'Live monitor', level: 1 })).toBeVisible()
  await expect(row().getByText('Not started')).toBeVisible()
  await expect(notStarted()).toContainText('1')
  await expect(ins.getByRole('region', { name: 'Totals' })).toContainText('Started0 of 1')
})

test('2. the student opens the workspace: the time appears live and Not started drops by 1', async () => {
  await stu.goto(`/my/classes/${lab.classId}/workspace?activity=${lab.activityId}`)
  await expect(stu.getByRole('tab', { name: /^main\.py/ })).toHaveAttribute('aria-selected', 'true')

  // No reload on the instructor's side: the "started" event updates the row, the chip and the card.
  const started = row().getByRole('cell').nth(1)
  await expect(started).toContainText(TIME, { timeout: 15_000 })
  await expect(notStarted()).toContainText('0')
  await expect(ins.getByRole('region', { name: 'Totals' })).toContainText('Started1 of 1')
  // Opening the activity's file is recorded too.
  await expect(started).toContainText('1 activity')
  await started.getByText('1 activity').click()
  await expect(started).toContainText(new RegExp(`${TITLE} — ${TIME.source}`))
})

test('3. reloading the workspace does not change the time', async () => {
  const started = row().getByRole('cell').nth(1)
  const first = await started.locator('time').getAttribute('datetime')
  expect(first).toBeTruthy()

  await stu.waitForTimeout(1500)
  await stu.reload()
  await expect(stu.getByRole('tab', { name: /^main\.py/ })).toBeVisible()
  // The saved time (from the snapshot) is still the first one.
  await ins.reload()
  await expect(row().getByRole('cell').nth(1).locator('time')).toHaveAttribute('datetime', first!)
  await expect(notStarted()).toContainText('0')
})
