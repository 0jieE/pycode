import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { account } from './accounts'
import { approveAll, createLab, join, type Lab } from './lab'

/**
 * Programs that stop at input(): the student answers in a box over the terminal. The class and its files are
 * made through the API; everything the student does goes through the UI.
 */

const run = Date.now().toString(36)
const TITLE = `Interactive ${run}`
const STUDENT = 'student14'

const FILES = [
  {
    path: 'sum.py',
    content:
      'a = input("Enter first number: ")\nb = input("Enter second number: ")\nprint("Sum:", int(a) + int(b))\n',
  },
  {
    path: 'loop.py',
    content: 'for i in range(3):\n    name = input(f"Name {i + 1}: ")\n    print("Hello,", name)\n',
  },
  { path: 'forever.py', content: 'while True:\n    input("again? ")\n' },
  { path: 'hello.py', content: 'print("no questions asked")\n' },
  // Runs on without asking anything (sleeping costs no CPU time, so only Stop ends it early).
  {
    path: 'busy.py',
    content: 'import time\nprint("working", flush=True)\nwhile True:\n    time.sleep(0.5)\n',
  },
  {
    path: 'eof.py',
    content: 'try:\n    input("x: ")\nexcept EOFError:\n    print("no more input")\n',
  },
]

let stu: Page
let ins: APIRequestContext
let lab: Lab

const dialog = () => stu.getByRole('dialog', { name: 'Program is waiting for input' })
const terminal = () => stu.getByRole('log', { name: 'Program output' })
const runButton = () => stu.getByRole('button', { name: 'Run', exact: true })

/** The server leaves 3 seconds between a student's runs. */
const pause = () => stu.waitForTimeout(3500)

async function runFile(name: string) {
  await stu.getByLabel('File to run').selectOption(`${TITLE}/${name}`)
  await runButton().click()
}

async function answer(prompt: string, value: string) {
  await expect(dialog()).toBeVisible({ timeout: 30_000 })
  await expect(dialog()).toContainText(prompt)
  await dialog().getByRole('textbox').fill(value)
  await dialog().getByRole('textbox').press('Enter')
}

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  ins = await playwright.request.newContext({ baseURL })
  const login = await ins.post('/api/v1/auth/login', {
    data: { username: 'instructor2', password: account('instructor2').password },
  })
  expect(login.ok()).toBeTruthy()

  stu = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  const a = account(STUDENT)
  await stu.goto('/login')
  await stu.getByLabel('Username').fill(a.username)
  await stu.getByLabel('Password').fill(a.password)
  await stu.getByRole('button', { name: 'Sign in' }).click()
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()

  lab = await createLab(ins, { name: `Interactive Class ${run}`, title: TITLE, files: FILES })
  await join(stu.request, lab)
  expect(await approveAll(ins, lab)).toBe(1)

  await stu.goto(`/my/classes/${lab.classId}/workspace?activity=${lab.activityId}`)
  await expect(stu.getByLabel('File to run')).toBeVisible()
})

test('0. a program that asks nothing just runs and finishes, with no box', async () => {
  await expect(stu.getByRole('radio', { name: 'Interactive' })).toBeChecked()
  await runFile('hello.py')
  await expect(stu.getByText(/Finished in \d+ ms/)).toBeVisible({ timeout: 30_000 })
  await expect(terminal()).toContainText('no questions asked')
  await expect(dialog()).toHaveCount(0)
  // Nothing was typed, so there is nothing to run again with.
  await expect(stu.getByRole('button', { name: 'Run again with same inputs' })).toHaveCount(0)
  await pause()
})

test('1. Interactive is the default; two inputs are answered in the box and shown in the terminal', async () => {
  await expect(stu.getByRole('radio', { name: 'Interactive' })).toBeChecked()
  await expect(stu.getByLabel('Program input (one value per line, read by input())')).toHaveCount(0)

  await runFile('sum.py')
  await expect(dialog()).toBeVisible({ timeout: 30_000 })
  // The box says what is being asked, and the status line counts down the 2 minutes the server allows.
  await expect(
    dialog().getByRole('heading', { name: 'Program is waiting for input' }),
  ).toBeVisible()
  await expect(dialog()).toContainText('Enter first number:')
  await expect(stu.getByText(/Waiting for input… 1:5\d|Waiting for input… 2:00/)).toBeVisible()
  await expect(dialog().getByRole('textbox')).toBeFocused()

  await answer('Enter first number:', '5')
  await answer('Enter second number:', '7')

  // The prompt, then what was typed after it, then the program's own output.
  await expect(stu.getByText(/Finished in \d+ ms/)).toBeVisible({ timeout: 30_000 })
  await expect(terminal()).toContainText('Enter first number: 5')
  await expect(terminal()).toContainText('Enter second number: 7')
  await expect(terminal()).toContainText('Sum: 12')
  await expect(dialog()).toHaveCount(0)
  // The typed values are in a different colour from the program's output.
  await expect(
    terminal()
      .locator('span', { hasText: /^5\s*$/ })
      .first(),
  ).toHaveCSS('color', 'rgb(124, 196, 250)') // --color-open
  await expect(terminal().locator('span', { hasText: 'Sum' })).toHaveCount(0)
})

test('2. the typed values land in the input list, and "Run again with same inputs" needs no questions', async () => {
  await expect(stu.getByLabel('Inputs from the last run (one value per line)')).toHaveValue('5\n7')
  const again = stu.getByRole('button', { name: 'Run again with same inputs' })
  await expect(again).toBeVisible()

  await pause()
  await again.click()
  await expect(stu.getByText(/Finished in \d+ ms/)).toBeVisible({ timeout: 30_000 })
  await expect(terminal()).toContainText('Sum: 12')
  await expect(dialog()).toHaveCount(0)
})

test('3. a loop that asks three times opens the box three times', async () => {
  await pause()
  await runFile('loop.py')
  for (const [i, name] of ['Ana', 'Ben', 'Cy'].entries()) {
    await answer(`Name ${i + 1}:`, name)
  }
  await expect(stu.getByText(/Finished in \d+ ms/)).toBeVisible({ timeout: 30_000 })
  await expect(terminal()).toContainText('Name 1: Ana')
  await expect(terminal()).toContainText('Hello, Ben')
  await expect(terminal()).toContainText('Name 3: Cy')
  await expect(stu.getByLabel('Inputs from the last run (one value per line)')).toHaveValue(
    'Ana\nBen\nCy',
  )
})

test('4. Stop ends a program that keeps asking, and End input makes input() raise EOFError', async () => {
  await pause()
  await runFile('forever.py')
  await answer('again?', 'one')
  await expect(dialog()).toBeVisible({ timeout: 30_000 })
  await dialog().getByRole('button', { name: 'Stop program' }).click()
  await expect(stu.getByText(/Stopped: you ended the program/)).toBeVisible({ timeout: 30_000 })
  await expect(dialog()).toHaveCount(0)

  await pause()
  await runFile('eof.py')
  await expect(dialog()).toBeVisible({ timeout: 30_000 })
  await dialog().getByRole('button', { name: 'End input (EOF)' }).click()
  await expect(terminal()).toContainText('no more input', { timeout: 30_000 })
  await expect(stu.getByText(/Finished in \d+ ms/)).toBeVisible()
})

test('4b. Stop next to Run ends a program that is running without asking for input', async () => {
  await pause()
  await runFile('busy.py')
  await expect(terminal()).toContainText('working', { timeout: 30_000 })
  await expect(dialog()).toHaveCount(0)
  await stu.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(stu.getByText(/Stopped: you ended the program/)).toBeVisible({ timeout: 30_000 })
  await expect(stu.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
})

test('5. "Use input list" still works the old way, and has no box', async () => {
  await pause()
  await stu.getByRole('radio', { name: 'Use input list' }).click()
  await stu.getByLabel('Program input (one value per line, read by input())').fill('3\n4')
  await runFile('sum.py')
  await expect(stu.getByText(/Finished in \d+ ms/)).toBeVisible({ timeout: 30_000 })
  await expect(terminal()).toContainText('Sum: 7')
  await expect(dialog()).toHaveCount(0)
})
