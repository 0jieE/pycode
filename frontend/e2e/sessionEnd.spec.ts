import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'
import { createRoom, roomName } from './lab'

/**
 * A lab session closes by itself at its scheduled end: the student's workspace turns read-only at that moment
 * with "The lab session has ended", the instructor cannot open it again until the end time is moved, and a
 * running session can be extended.
 */

const run = Date.now().toString(36)
const BATCH = `Ends soon ${run}`
const STUDENT = 'student21'

let ins: Page
let stu: Page
let classId = 0
let sessionId = 0

async function signIn(page: Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(account(username).password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** "YYYY-MM-DDTHH:mm" in Manila time (UTC+8, no daylight saving), as a datetime-local input wants it. */
const manilaInput = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 16)

const row = () => ins.getByRole('row', { name: new RegExp(BATCH) })

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  ins = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await signIn(ins, 'instructor2')
  await expect(ins.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()

  const cls = await ins.request.post('/api/v1/classes', {
    data: { name: `E2E Ends ${run}`, year_and_section: 'BSIT E-1', school_year: '2026-2027' },
  })
  classId = (await cls.json()).id
  const code = await ins.request.post(`/api/v1/classes/${classId}/invite-codes`, {
    data: {
      // A minute back: the server stores whole seconds, so "now" could still lie ahead of it.
      valid_from: new Date(Date.now() - 60_000).toISOString(),
      valid_until: new Date(Date.now() + 864e5).toISOString(),
    },
  })
  // Something to edit: files live in activity folders (the top level of the workspace is not the student's).
  const activity = await ins.request.post(`/api/v1/classes/${classId}/activities`, {
    data: { title: `Work ${run}`, starter_files: [{ path: 'main.py', content: "print('hi')\n" }] },
  })
  expect(activity.ok(), await activity.text()).toBeTruthy()
  expect(
    (await ins.request.post(`/api/v1/activities/${(await activity.json()).id}/publish`)).ok(),
  ).toBeTruthy()
  const roomId = await createRoom(ins.request, roomName('Ends room'))
  const session = await ins.request.post(`/api/v1/classes/${classId}/sessions`, {
    data: {
      name: BATCH,
      lab_id: roomId,
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 25_000).toISOString(),
    },
  })
  expect(session.ok(), await session.text()).toBeTruthy()
  sessionId = (await session.json()).id
  expect((await ins.request.patch(`/api/v1/sessions/${sessionId}/open`)).ok()).toBeTruthy()

  stu = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await signIn(stu, STUDENT)
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  const joined = await stu.request.post('/api/v1/enroll', {
    data: { code: (await code.json()).code },
  })
  expect([200, 201], await joined.text()).toContain(joined.status())
  const pending = await ins.request.get(`/api/v1/classes/${classId}/enrollments?status=pending`)
  for (const e of (await pending.json()).items as { id: number }[]) {
    await ins.request.patch(`/api/v1/enrollments/${e.id}`, { data: { action: 'approve' } })
  }
})

test('1. at its end time the student workspace turns read-only by itself', async () => {
  test.setTimeout(60_000)
  await stu.goto(`/my/classes/${classId}/workspace`)
  await stu.getByRole('treeitem', { name: /^main\.py/ }).click()
  const editor = stu.locator('.cm-content')
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  // The last 10 minutes show a countdown in the status bar.
  await expect(stu.getByText(/^Ends in \d+:\d\d$/)).toBeVisible()

  await expect(stu.getByText('The lab session has ended.')).toBeVisible({ timeout: 40_000 })
  await expect(
    stu.getByText('Laboratory access is closed: your workspace is read-only.'),
  ).toBeVisible()
  await expect(editor).toHaveAttribute('contenteditable', 'false')
})

test('2. an ended session cannot be opened until its end time is moved', async () => {
  // Just after the end, before the server's sweep (every 15 s) has flagged it closed: still refused. Two seconds
  // of margin: the browser's clock and the server's can differ by a fraction of a second.
  await ins.waitForTimeout(2000)
  const refused = await ins.request.patch(`/api/v1/sessions/${sessionId}/open`)
  expect(refused.status()).toBe(409)
  expect((await refused.json()).code).toBe('SESSION_ENDED')

  await ins.goto(`/classes/${classId}?tab=sessions`)
  await expect(ins.getByRole('heading', { name: 'Laboratory is CLOSED' })).toBeVisible()
  await expect(row().getByRole('button', { name: `Open ${BATCH}` })).toBeDisabled()

  await row()
    .getByRole('button', { name: `Change the times of ${BATCH}` })
    .click()
  const dialog = ins.getByRole('dialog', { name: 'Session name and times' })
  await dialog.getByLabel('Ends').fill(manilaInput(Date.now() + 40 * 60_000))
  await dialog.getByRole('button', { name: 'Save' }).click()
  // Still flagged open (the sweep may not have run yet) or already closed: either way a later end time does not
  // let students back in by itself. Open does.
  await expect(ins.getByText(/^Session saved/)).toBeVisible()
  await expect(ins.getByRole('heading', { name: 'Laboratory is CLOSED' })).toBeVisible()
  await expect(stu.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')

  await row()
    .getByRole('button', { name: `Open ${BATCH}` })
    .click()
  await expect(ins.getByRole('heading', { name: 'Laboratory is OPEN' })).toBeVisible()
  await expect(ins.getByText(/^Ends at \d{1,2}:\d\d (AM|PM)$/).first()).toBeVisible()
})

test('3. a running session can be extended, and the student can work again', async () => {
  await ins.getByRole('button', { name: 'Extend 30 min' }).click()
  await expect(ins.getByText(/Extended: it now ends at/)).toBeVisible()
  const s = await (await ins.request.get(`/api/v1/classes/${classId}/sessions/current`)).json()
  expect(new Date(s.ends_at).getTime() - Date.now()).toBeGreaterThan(65 * 60_000)

  await expect(stu.locator('.cm-content')).toHaveAttribute('contenteditable', 'true', {
    timeout: 20_000,
  })
})
