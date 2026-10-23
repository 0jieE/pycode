import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { account } from './accounts'

/**
 * The Python Tutorial, as a student who has not started it: lesson 1's "Try it" runs, its exercise passes on
 * Check, the progress bar counts it; and with "Unlock lessons in order" on in their class, lesson 3 stays
 * locked until lesson 2 is passed.
 *
 * Progress is kept for good, so each run uses a seeded student who has passed nothing yet.
 */

const run = Date.now().toString(36)
const CANDIDATES = Array.from({ length: 12 }, (_, i) => `student${18 + i}`)

let stu: Page
let ins: Page
let username = ''
let slugs: string[] = []
let total = 0

const lessonList = () => stu.getByRole('complementary', { name: 'Lessons' })

async function signIn(page: Page, name: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(name)
  await page.getByLabel('Password').fill(account(name).password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Waits for a run or check to end, from its stored result. */
async function finished(api: APIRequestContext, executionId: number) {
  await expect
    .poll(async () => (await (await api.get(`/api/v1/executions/${executionId}`)).json()).status, {
      timeout: 60_000,
    })
    .not.toMatch(/^(queued|running)$/)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  test.setTimeout(90_000)
  // A student with no tutorial progress yet.
  for (const name of CANDIDATES) {
    const ctx = await playwright.request.newContext({ baseURL })
    const login = await ctx.post('/api/v1/auth/login', {
      data: { username: name, password: account(name).password },
    })
    if (login.ok()) {
      const lessons = (await (await ctx.get('/api/v1/tutorial/lessons')).json()) as {
        slug: string
        passed: boolean
        attempts: number
      }[]
      if (lessons.every((l) => !l.passed && l.attempts === 0)) {
        username = name
        slugs = lessons.map((l) => l.slug)
        total = lessons.length
      }
    }
    await ctx.dispose()
    if (username) break
  }
  expect(username, 'every candidate student already has tutorial progress').not.toBe('')
  expect(total).toBeGreaterThanOrEqual(3)

  // Their class has "Unlock lessons in order" on.
  ins = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await signIn(ins, 'instructor1')
  await expect(ins.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()
  const cls = await ins.request.post('/api/v1/classes', {
    data: { name: `E2E Tutorial ${run}`, year_and_section: 'BSIT T-1', school_year: '2026-2027' },
  })
  expect(cls.ok()).toBeTruthy()
  const classId = (await cls.json()).id as number
  const code = await ins.request.post(`/api/v1/classes/${classId}/invite-codes`, {
    data: {
      // A minute back: the server stores whole seconds, so "now" could still lie ahead of it.
      valid_from: new Date(Date.now() - 60_000).toISOString(),
      valid_until: new Date(Date.now() + 864e5).toISOString(),
    },
  })

  stu = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await signIn(stu, username)
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  const joined = await stu.request.post('/api/v1/enroll', {
    data: { code: (await code.json()).code },
  })
  expect([200, 201]).toContain(joined.status())
  const pending = await ins.request.get(
    `/api/v1/classes/${classId}/enrollments?status=pending&size=100`,
  )
  for (const e of (await pending.json()).items as { id: number }[]) {
    await ins.request.patch(`/api/v1/enrollments/${e.id}`, { data: { action: 'approve' } })
  }
  const inOrder = await ins.request.patch(`/api/v1/classes/${classId}`, {
    data: { tutorial_unlock_in_order: true },
  })
  expect(inOrder.ok()).toBeTruthy()
})

test('1. the tutorial opens at lesson 1, and "Try it" runs an example', async () => {
  await stu
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Python Tutorial' })
    .click()
  await expect(stu).toHaveURL(new RegExp(`/tutorial/${slugs[0]}$`))
  await expect(stu.getByRole('heading', { level: 1, name: 'Printing output' })).toBeVisible()
  await expect(lessonList()).toContainText(`0 of ${total} completed`)

  await stu.getByRole('button', { name: 'Try it: Your first program' }).click()
  const pane = stu.getByRole('region', { name: 'Try it' })
  await expect(pane.locator('.cm-content')).toContainText('print("Hello, world!")')
  await pane.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(pane.getByRole('log', { name: 'Program output' })).toContainText('Hello, world!', {
    timeout: 30_000,
  })
})

test('2. Check passes the exercise, and the progress counts it', async () => {
  const exercise = stu.getByRole('region', { name: 'Exercise' })
  await exercise.locator('.cm-content').click()
  await stu.keyboard.press('Control+A')
  await stu.keyboard.type(
    'print("Hello, BSIT!")\nprint("Python is fun.")\nprint("Let\'s start coding.")',
  )
  await stu.waitForTimeout(3300) // the cooldown after the Try it run

  await exercise.getByRole('button', { name: 'Check' }).click()
  await expect(exercise.getByRole('region', { name: 'Test results' })).toContainText(
    /Passed (\d+) of \1 tests/,
    { timeout: 60_000 },
  )
  await expect(stu.getByText('Every test passed. Well done!')).toBeVisible()
  await expect(lessonList()).toContainText(`1 of ${total} completed`)
  await expect(stu.getByRole('link', { name: 'Next lesson' })).toBeVisible()
})

test('3. with lessons in order, lesson 3 is locked until lesson 2 is passed', async () => {
  const third = lessonList().getByText(/^3\./).locator('xpath=..')
  await expect(third).toHaveAttribute('aria-disabled', 'true')
  await stu.goto(`/tutorial/${slugs[2]}`)
  await expect(stu.getByText('This lesson is locked')).toBeVisible()

  // Lesson 2 passed (with the reference solution, through the API: lesson 1 already showed the screens).
  const lesson2 = await (
    await ins.request.get(`/api/v1/tutorial/manage/lessons/${slugs[1]}`)
  ).json()
  await stu.waitForTimeout(3300) // the gap the server wants between two runs or checks
  const started = await stu.request.post(`/api/v1/tutorial/lessons/${slugs[1]}/check`, {
    data: {
      files: [
        { path: lesson2.exercise.entry ?? 'main.py', content: lesson2.exercise.reference_solution },
      ],
    },
  })
  expect(started.ok(), await started.text()).toBeTruthy()
  await finished(stu.request, (await started.json()).execution_id)

  await stu.reload()
  await expect(lessonList()).toContainText(`2 of ${total} completed`, { timeout: 10_000 })
  await expect(stu.getByRole('heading', { level: 1, name: /.+/ })).not.toHaveText('')
  await expect(stu.getByText('This lesson is locked')).toHaveCount(0)
  await expect(lessonList().getByRole('link', { name: /^3\./ })).toBeVisible()
})
