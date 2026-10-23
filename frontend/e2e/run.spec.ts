import { expect, test, type Locator, type Page } from '@playwright/test'
import { account } from './accounts'
import { approveAll, createLab, join, type Lab } from './lab'

/**
 * Run, in a real browser against the real sandbox: output streams while the program is still
 * running, limits give plain-English messages, and 429/503 and a dead socket are handled.
 */

const run = Date.now().toString(36)
const STUDENT = 'student11'
const TITLE = `Run ${run}`

const FILES = [
  { path: 'helpers.py', content: "def greet(name):\n    return 'hello ' + name\n" },
  { path: 'main.py', content: 'import helpers\nname = input()\nprint(helpers.greet(name))\n' },
  {
    path: 'slow.py',
    content: "import time\nprint('first', flush=True)\ntime.sleep(3)\nprint('second')\n",
  },
  { path: 'boom.py', content: "print('before the crash')\nprint(1 / 0)\n" },
  { path: 'loop.py', content: 'while True:\n    pass\n' },
  { path: 'flood.py', content: "while True:\n    print('x' * 1000)\n" },
]

let page: Page
let lab: Lab

const terminal = (): Locator => page.getByRole('log', { name: 'Program output' })
const runButton = () => page.getByRole('button', { name: 'Run', exact: true })

/**
 * The backend allows one run every 3 seconds per student, so real runs wait out that cooldown. On a
 * busy machine the timing can still be a hair off: if the run is refused as "too fast", wait for the
 * button to come back and click again. (The refusal itself is tested separately, with a mocked 429.)
 */
let lastRunClick = 0
async function clickRun() {
  const wait = 3300 - (Date.now() - lastRunClick)
  if (wait > 0) await page.waitForTimeout(wait)
  for (let attempt = 0; attempt < 3; attempt++) {
    lastRunClick = Date.now()
    await runButton().click()
    await page.waitForTimeout(700)
    const refused = page.getByText(/You are running too fast|Your last run is still going/)
    if ((await refused.count()) === 0) return
    await expect(runButton()).toBeEnabled({ timeout: 10_000 })
  }
}

async function openFile(name: string) {
  await page.getByRole('treeitem', { name: new RegExp(`^${name.replace('.', '\\.')}`) }).click()
  await expect(
    page.getByRole('tab', { name: new RegExp(`^${name.replace('.', '\\.')}`) }),
  ).toHaveAttribute('aria-selected', 'true')
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  const ins = await playwright.request.newContext({ baseURL })
  await ins.post('/api/v1/auth/login', {
    data: { username: 'instructor1', password: account('instructor1').password },
  })
  lab = await createLab(ins, { name: `E2E Run ${run}`, title: TITLE, files: FILES })

  page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await page.goto('/login')
  await page.getByLabel('Username').fill(STUDENT)
  await page.getByLabel('Password').fill(account(STUDENT).password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  await join(page.request, lab)
  await approveAll(ins, lab)
  await ins.dispose()

  await page.goto(`/my/classes/${lab.classId}/workspace?activity=${lab.activityId}`)
  await expect(page.getByRole('tab', { name: /^main\.py/ })).toBeVisible()
})

test('1. runs the open file with program input, and a second file it imports', async () => {
  await page.getByRole('radio', { name: 'Use input list' }).click()
  await page.getByLabel('Program input (one value per line, read by input())').fill('Mia')
  await clickRun()

  await expect(terminal()).toContainText('hello Mia', { timeout: 20_000 })
  await expect(page.getByText(/Finished in \d+ ms \(exit 0\)/)).toBeVisible()
  // The Run button is usable again.
  await expect(runButton()).toBeEnabled()
})

test('2. output streams while the program is still running', async () => {
  await openFile('slow.py')
  await clickRun()

  await expect(terminal()).toContainText('first', { timeout: 20_000 })
  // The program sleeps 3 s after "first": at this moment it is still running.
  await expect(page.getByText(/Running… \d+ s/)).toBeVisible()
  await expect(terminal()).not.toContainText('second')
  await expect(runButton()).toBeDisabled()

  await expect(terminal()).toContainText('second', { timeout: 10_000 })
  await expect(page.getByText(/Finished in \d+ ms \(exit 0\)/)).toBeVisible()
})

test('3. Ctrl+Enter runs the file and does not type a blank line into the code', async () => {
  await openFile('main.py')
  await page.getByRole('radio', { name: 'Use input list' }).click()
  await page.getByLabel('Program input (one value per line, read by input())').fill('Ben')
  const before = await page.locator('.cm-content').innerText()
  await page.locator('.cm-content').click()
  // Count the live connections this run opens: it must be exactly one.
  const runSockets: string[] = []
  const onSocket = (ws: { url: () => string }) => {
    if (ws.url().includes('/ws/run/')) runSockets.push(ws.url())
  }
  page.on('websocket', onSocket)
  const cooldownStart = Date.now()
  await page.keyboard.press('Control+Enter')
  lastRunClick = cooldownStart

  await expect(terminal()).toContainText('hello Ben', { timeout: 20_000 })
  await expect(page.getByText(/Finished in \d+ ms/)).toBeVisible()
  expect(await page.locator('.cm-content').innerText()).toBe(before)
  page.off('websocket', onSocket)
  expect(runSockets, 'one run = one live connection').toHaveLength(1)
})

test('4. a crash shows a red "Exited with code" line and the traceback', async () => {
  await openFile('boom.py')
  await clickRun()

  await expect(page.getByText('Exited with code 1')).toBeVisible({ timeout: 20_000 })
  await expect(terminal()).toContainText('before the crash')
  await expect(terminal()).toContainText('ZeroDivisionError')
})

test('5. text typed a moment ago is saved before it runs', async () => {
  await openFile('main.py')
  await page.getByRole('radio', { name: 'Use input list' }).click()
  await page.getByLabel('Program input (one value per line, read by input())').fill('Zoe')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type("print('edited just now')")
  // No pause: the autosave countdown is still running when Run is clicked.
  await clickRun()

  await expect(terminal()).toContainText('edited just now', { timeout: 20_000 })
  await expect(terminal()).toContainText('hello Zoe')
})

test('6. an endless loop is stopped, with an amber explanation', async () => {
  await openFile('loop.py')
  await clickRun()

  const message = page.getByText(/Stopped: the program ran for more than 10 seconds/)
  await expect(message).toBeVisible({ timeout: 30_000 })
  await expect(runButton()).toBeEnabled()
  // Amber, not red: the colour is the warning tone.
  await expect(message).toHaveCSS('color', 'rgb(251, 191, 36)') // --color-warn
})

test('7. printing forever is stopped at the output limit', async () => {
  await openFile('flood.py')
  await clickRun()
  await expect(page.getByText(/Stopped: the program printed too much/)).toBeVisible({
    timeout: 30_000,
  })
  // The page stayed responsive and shows only the tail, capped for the screen.
  const shown = await terminal().innerText()
  expect(shown.length).toBeLessThan(70 * 1024)
})

test('8. a busy answer (429) is a friendly message with a short countdown', async () => {
  await openFile('main.py')
  await page.route('**/api/v1/workspace/*/run', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Please wait', code: 'RUN_TOO_FAST' }),
    }),
  )
  await runButton().click()

  await expect(
    page.getByText(/You are running too fast\. You can run again in \d s\./),
  ).toBeVisible()
  await expect(runButton()).toBeDisabled()
  // After the pause the button works again.
  await expect(runButton()).toBeEnabled({ timeout: 6000 })
  await page.unroute('**/api/v1/workspace/*/run')
})

test('9. a busy server (503) says so, with a longer pause', async () => {
  await page.route('**/api/v1/workspace/*/run', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Server busy, try again', code: 'SERVER_BUSY' }),
    }),
  )
  await runButton().click()
  await expect(
    page.getByText(/The server is busy right now\. You can run again in \d s\./),
  ).toBeVisible()
  await expect(runButton()).toBeDisabled()
  await expect(runButton()).toBeEnabled({ timeout: 8000 })
  await page.unroute('**/api/v1/workspace/*/run')
})

test('10. if the live connection fails, the result still arrives (polling)', async () => {
  // Every run socket is closed straight away; the page must fetch the stored result instead.
  await page.routeWebSocket(/\/api\/v1\/ws\/run\//, (ws) => ws.close())
  await page.getByRole('radio', { name: 'Use input list' }).click()
  await page.getByLabel('Program input (one value per line, read by input())').fill('Poll')
  await clickRun()

  await expect(terminal()).toContainText('hello Poll', { timeout: 25_000 })
  await expect(page.getByText(/Finished in \d+ ms \(exit 0\)/)).toBeVisible()
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('11. Clear empties the terminal', async () => {
  await expect(terminal()).toContainText('hello Poll')
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(terminal()).toContainText('Output appears here.')
  await expect(page.getByText(/Finished in/)).toHaveCount(0)
})
