import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'
import { approveAll, createLab, join, type Lab } from './lab'

/**
 * Automatic grading, start to finish, with the instructor and the student in separate browsers:
 *   the instructor adds a sample and a hidden test case (through the UI) and tries one,
 *   the student presses Test (fails), fixes the code, presses Test (passes), submits,
 *   and the instructor sees the score.
 * The class, session and published activity are set up through the API; everything else is the UI.
 */

const run = Date.now().toString(36)
const STUDENT = 'student09'
const TITLE = `Greeter ${run}`
// A program that is close but wrong: the tests want "Hello, <name>!".
const BUGGY = "name = input()\nprint('Hi, ' + name)\n"

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

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeAll(async ({ browser }) => {
  const open = async () =>
    (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  ins = await open()
  stu = await open()
  await signIn(ins, 'instructor2')
  await expect(ins.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()

  lab = await createLab(ins.request, {
    name: `E2E Tests Class ${run}`,
    title: TITLE,
    files: [{ path: 'main.py', content: BUGGY }],
  })
  await signIn(stu, STUDENT)
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  await join(stu.request, lab)
  expect(await approveAll(ins.request, lab)).toBe(1)
})

test('1. the instructor adds a sample and a hidden test case, and tries one', async () => {
  await ins.goto(`/classes/${lab.classId}/activities/${lab.activityId}`)
  await ins.getByRole('tab', { name: 'Test cases' }).click()
  await expect(ins.getByText('No test cases yet')).toBeVisible()

  // How the tests run: the defaults are the entry file main.py and ignoring input() prompts.
  await expect(ins.getByLabel('Entry file')).toHaveValue('main.py')
  await expect(ins.getByRole('switch', { name: /Ignore input\(\) prompt text/ })).toBeChecked()

  // A sample case.
  await ins.getByRole('button', { name: 'Add the first test case' }).click()
  const editor = ins.getByRole('region', { name: 'New test case' })
  await editor.getByLabel('Name', { exact: true }).fill('Greets Ana')
  await editor.getByLabel('Input', { exact: true }).fill('Ana')
  await editor.getByLabel('Expected output').fill('Hello, Ana!')
  await editor.getByLabel('Points').fill('2')
  await editor.getByRole('button', { name: 'Save test case' }).click()
  await expect(ins.getByText('Test case added')).toBeVisible()

  // A hidden case.
  await ins.getByRole('button', { name: 'Add test case' }).click()
  const second = ins.getByRole('region', { name: 'New test case' })
  await second.getByLabel('Name', { exact: true }).fill('Greets Ben')
  await second.getByLabel('Input', { exact: true }).fill('Ben')
  await second.getByLabel('Expected output').fill('Hello, Ben!')
  await second.getByLabel('Points').fill('3')
  await second.getByRole('switch', { name: 'Hidden test case' }).click()
  await second.getByRole('button', { name: 'Save test case' }).click()

  // An Exact case, typed the natural way: the server ignores the one line break print() adds at the end,
  // so it is stored as typed and a plain print() still passes it (checked when the student tests).
  await expect(ins.getByRole('region', { name: 'Test case: Greets Ben' })).toBeVisible()
  await ins.getByRole('button', { name: 'Add test case' }).click()
  const third = ins.getByRole('region', { name: 'New test case' })
  await third.getByLabel('Name', { exact: true }).fill('Exact greeting')
  await third.getByLabel('Input', { exact: true }).fill('Cy')
  await third.getByLabel('Expected output').fill('Hello, Cy!')
  await third.getByLabel('Points').fill('0')
  await third.getByLabel('Match mode').selectOption('exact')
  await third.getByRole('button', { name: 'Save test case' }).click()
  await expect(ins.getByRole('region', { name: 'Test case: Exact greeting' })).toBeVisible()
  const stored = await ins.request.get(`/api/v1/activities/${lab.activityId}/test-cases`)
  const exact = ((await stored.json()) as { name: string; expected_output: string }[]).find(
    (c) => c.name === 'Exact greeting',
  )
  expect(exact?.expected_output).toBe('Hello, Cy!')

  // The list shows both, in order, with their kind and points.
  const list = ins.getByRole('list', { name: /Test cases, in the order they run/ })
  const items = list.getByRole('listitem')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText('Greets Ana')
  await expect(items.nth(0)).toContainText('Sample')
  await expect(items.nth(0)).toContainText('2 pts')
  await expect(items.nth(1)).toContainText('Greets Ben')
  await expect(items.nth(1)).toContainText('Hidden')
  await expect(items.nth(1)).toContainText('3 pts')
  await expect(ins.getByRole('heading', { name: /Cases/ })).toContainText('3 of 20 · 5 points')

  // Reordering: move the second case up, then back.
  await ins.getByRole('button', { name: 'Move Greets Ben up' }).click({ force: true })
  await expect(items.nth(0)).toContainText('Greets Ben')
  await ins.getByRole('button', { name: 'Move Greets Ben down' }).click({ force: true })
  await expect(items.nth(0)).toContainText('Greets Ana')

  // Try the sample case against the (buggy) starter files: it fails, and shows why.
  await items
    .nth(0)
    .getByRole('button', { name: /^Greets Ana/ })
    .click()
  await ins.getByRole('button', { name: 'Try', exact: true }).click()
  const tried = ins.getByLabel('Result of the try')
  await expect(tried).toBeVisible({ timeout: 60_000 })
  await expect(tried.getByText('Fail', { exact: true })).toBeVisible()
  await expect(tried).toContainText('Hi, Ana')
  await expect(tried).toContainText('Hello, Ana!')
  await expect(
    tried.getByLabel('Differences between your output and the expected output'),
  ).toBeVisible()
})

test('2. the student presses Test: both cases fail, the hidden one reveals nothing', async () => {
  await stu.goto(`/my/classes/${lab.classId}/workspace?activity=${lab.activityId}`)
  await expect(stu.getByRole('tab', { name: /^main\.py/ })).toHaveAttribute('aria-selected', 'true')

  await stu.getByRole('button', { name: 'Test', exact: true }).click()
  const header = stu.getByRole('status').filter({ hasText: /^Passed \d+ of \d+/ })
  await expect(header).toHaveText('Passed 0 of 3 tests · 0/5 pts', { timeout: 60_000 })

  // The sample case expands to Input, Your output, Expected output and a diff.
  const sample = stu.getByRole('button', { name: /Test Case #1/ })
  await expect(sample).toContainText('Fail')
  await sample.click()
  const results = stu.getByRole('region', { name: 'Test results' })
  await expect(results).toContainText('Hi, Ana')
  await expect(results).toContainText('Hello, Ana!')
  await expect(
    results.getByLabel('Differences between your output and the expected output'),
  ).toBeVisible()

  // The hidden case shows only its verdict.
  await expect(results.getByText('Hidden test — Fail')).toBeVisible()
  await expect(results).not.toContainText('Ben')
  await expect(results).not.toContainText('Hello, Ben!')
})

test('3. the student fixes the code and the tests pass', async () => {
  await stu.locator('.cm-content').click()
  await stu.keyboard.press('Control+a')
  await stu.keyboard.type("name = input()\nprint('Hello, ' + name + '!')")
  // The server wants 3 seconds between a student's jobs; pressing sooner is answered with "too fast".
  await stu.waitForTimeout(3500)
  await stu.getByRole('button', { name: 'Test', exact: true }).click()

  const header = stu.getByRole('status').filter({ hasText: /^Passed \d+ of \d+/ })
  await expect(header).toHaveText('Passed 3 of 3 tests · 5/5 pts', { timeout: 60_000 })
  await expect(stu.getByRole('button', { name: /Test Case #1/ })).toContainText('Pass')
  await expect(stu.getByText('Hidden test — Pass')).toBeVisible()
  // The panel's tab carries the tally.
  await expect(stu.getByRole('tab', { name: /Test results/ })).toContainText('3/3')
})

test('4. the student submits; the instructor sees the score', async () => {
  await stu.getByRole('button', { name: 'Submit', exact: true }).click()
  await stu
    .getByRole('dialog', { name: `Submit everything in '${TITLE}'?` })
    .getByRole('button', { name: 'Submit' })
    .click()
  await expect(stu.getByText(/Submitted .*(AM|PM)/)).toBeVisible()

  await ins.goto(`/classes/${lab.classId}/activities/${lab.activityId}/submissions`)
  const row = ins.getByRole('row', { name: /Student 09/ })
  // Grading takes a few seconds; the page looks again by itself until the score arrives.
  await expect(row.getByText('5/5')).toBeVisible({ timeout: 90_000 })
  await expect(row.getByText('3 of 3 tests')).toBeVisible()

  // The Score column sorts.
  const score = ins.getByRole('columnheader', { name: /Score/ })
  await score.getByRole('button').click()
  await expect(score).toHaveAttribute('aria-sort', 'descending')
  await score.getByRole('button').click()
  await expect(score).toHaveAttribute('aria-sort', 'ascending')

  // Re-grade all asks first, then queues the grading again.
  await ins.getByRole('button', { name: 'Re-grade all' }).click()
  const confirm = ins.getByRole('dialog', { name: 'Re-grade every submission?' })
  await confirm.getByRole('button', { name: 'Re-grade all' }).click()
  await expect(ins.getByText(/Re-grading 1 submission/)).toBeVisible()
  await expect(row.getByText('5/5')).toBeVisible({ timeout: 60_000 })

  // The snapshot shows the score too.
  await row.getByRole('link', { name: /View work of/ }).click()
  await expect(ins.getByText('Score 5/5')).toBeVisible()
  await expect(ins.getByText(/3 of 3 tests passed/)).toBeVisible()
})

test('5. the class home remembers the last test result', async () => {
  await stu.goto(`/my/classes/${lab.classId}`)
  const card = stu.getByRole('listitem').filter({ hasText: TITLE })
  await expect(card.getByText('Last test: 3/3 passed')).toBeVisible()
})

test('6. a hardcoded answer: input not read, and the instructor is told', async () => {
  await stu.goto(`/my/classes/${lab.classId}/workspace?activity=${lab.activityId}`)
  await expect(stu.getByRole('tab', { name: /^main\.py/ })).toHaveAttribute('aria-selected', 'true')
  await stu.locator('.cm-content').click()
  await stu.keyboard.press('Control+a')
  // Prints the hidden case's answer without reading the input.
  await stu.keyboard.type("print('Hello, Ben!')")
  await stu.waitForTimeout(3500)
  await stu.getByRole('button', { name: 'Test', exact: true }).click()

  const header = stu.getByRole('status').filter({ hasText: /^Passed \d+ of \d+/ })
  await expect(header).toHaveText(/^Passed 0 of 3 tests/, { timeout: 60_000 })
  const results = stu.getByRole('region', { name: 'Test results' })
  await expect(results.getByText('Input not read').first()).toBeVisible()
  await expect(results.getByText(/did not read all the input/).first()).toBeVisible()

  await stu.waitForTimeout(3500)
  // Already submitted once (step 4): the button now says so.
  await stu.getByRole('button', { name: 'Submit again', exact: true }).click()
  await stu
    .getByRole('dialog', { name: `Submit everything in '${TITLE}'?` })
    .getByRole('button', { name: 'Submit' })
    .click()
  await expect(stu.getByText(/Submitted .*(AM|PM)/)).toBeVisible()
  // A student never sees the flag.
  await expect(stu.getByText('Possible hardcoded answer')).toHaveCount(0)

  await ins.goto(`/classes/${lab.classId}/activities/${lab.activityId}/submissions`)
  const row = ins.getByRole('row', { name: /Student 09/ })
  await expect(row.getByText('Possible hardcoded answer')).toBeVisible({ timeout: 90_000 })
  await row.getByRole('link', { name: /View work of/ }).click()
  await expect(
    ins.getByText(/contains the expected output of hidden case Greets Ben/),
  ).toBeVisible()
})

test('7. code requirements: shown to the student, and breaking one fails every case', async () => {
  await ins.goto(`/classes/${lab.classId}/activities/${lab.activityId}`)
  await ins.getByRole('tab', { name: 'Test cases' }).click()
  const section = ins.getByRole('region', { name: 'Code requirements' })
  await section.getByLabel('Functions it must define').fill('greet')
  await expect(section.getByText('Define a function named greet().')).toBeVisible()
  await section.getByRole('button', { name: 'Save requirements' }).click()
  await expect(ins.getByText('Requirements saved')).toBeVisible()

  // The student reads them next to the instructions.
  await stu.goto(`/my/classes/${lab.classId}`)
  const card = stu.getByRole('listitem').filter({ hasText: TITLE })
  await card.getByText('Instructions').click()
  await expect(card.getByText('Define a function named greet().')).toBeVisible()

  // Correct output, but no greet(): every case fails, with the reason said once.
  await stu.goto(`/my/classes/${lab.classId}/workspace?activity=${lab.activityId}`)
  await expect(stu.getByRole('tab', { name: /^main\.py/ })).toHaveAttribute('aria-selected', 'true')
  await stu.locator('.cm-content').click()
  await stu.keyboard.press('Control+a')
  await stu.keyboard.type("name = input()\nprint('Hello, ' + name + '!')")
  await stu.waitForTimeout(3500)
  await stu.getByRole('button', { name: 'Test', exact: true }).click()
  const header = stu.getByRole('status').filter({ hasText: /^Passed \d+ of \d+/ })
  await expect(header).toHaveText(/^Passed 0 of 3 tests/, { timeout: 60_000 })
  const results = stu.getByRole('region', { name: 'Test results' })
  await expect(results.getByRole('alert')).toContainText(/greet/)

  // Removing them: the next Test passes again.
  await section.getByRole('button', { name: 'Remove all' }).click()
  await expect(ins.getByText('Requirements removed')).toBeVisible()
  await stu.waitForTimeout(3500)
  await stu.getByRole('button', { name: 'Test', exact: true }).click()
  await expect(header).toHaveText('Passed 3 of 3 tests · 5/5 pts', { timeout: 60_000 })
})
