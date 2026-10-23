import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { account } from './accounts'

/**
 * Self sign-up with one-time registration codes: the admin makes codes, a student creates an account
 * with one, and it works exactly once. All through the UI, with a separate browser for each person.
 */

const run = Date.now().toString(36)
const PASSWORD = 'Passw0rd-signup'
const INVALID_CODE = 'Invalid or expired code. Ask your administrator for a new one.'

let admin: Page
let nextUser = 0

/** A username/student number nobody has used: every run, and every call, is different. */
const fresh = () => {
  nextUser++
  return { username: `su${nextUser}.${run}`, studentNo: `SU-${run}-${nextUser}` }
}

// Sign-up is limited to a few attempts a minute (see pressCreateAccount), so tests may wait for a slot.
test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  const a = account('admin')
  await admin.goto('/login')
  await admin.getByLabel('Username').fill(a.username)
  await admin.getByLabel('Password').fill(a.password)
  await admin.getByRole('button', { name: 'Sign in' }).click()
  await expect(admin.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible()
})

async function openCodesPage() {
  await admin
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Registration Codes' })
    .click()
  await expect(admin.getByRole('heading', { name: 'Registration codes', level: 1 })).toBeVisible()
}

/** The side bar's list of batches (each a link to its codes). */
const batchLink = (batch: string) =>
  admin
    .getByRole('navigation', { name: 'Batches list' })
    .getByRole('link', { name: new RegExp(`^${batch}`) })

async function openGenerate() {
  await admin.getByRole('button', { name: 'Generate codes' }).first().click()
  return admin.getByRole('dialog', { name: 'Generate registration codes' })
}

/** Generates ONE code through the Single tab and returns it (read from the one-time result dialog). */
async function generateSingle(opts: {
  batch: string
  studentNo?: string
  fullName?: string
}): Promise<string> {
  const dialog = await openGenerate()
  await dialog.getByRole('tab', { name: 'Single' }).click()
  await dialog.getByLabel('Batch name').fill(opts.batch)
  if (opts.studentNo) await dialog.getByLabel('Student number (optional)').fill(opts.studentNo)
  if (opts.fullName) await dialog.getByLabel('Full name (optional)').fill(opts.fullName)
  await dialog.getByRole('button', { name: 'Generate code' }).click()

  const result = admin.getByRole('dialog', { name: 'Your registration codes' })
  const codes = result.getByRole('list', { name: 'Registration codes' }).getByRole('listitem')
  await expect(codes).toHaveCount(1)
  const code = (await codes.first().innerText()).trim()
  expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
  await result.getByRole('button', { name: 'Done' }).click()
  await expect(result).toBeHidden()
  return code
}

interface SignupInput {
  code: string
  studentNo: string
  fullName?: string
  username: string
}

async function fillSignup(page: Page, input: SignupInput) {
  await page.getByLabel('Registration code').fill(input.code)
  await page.getByLabel('Student number').fill(input.studentNo)
  await page.getByLabel('Full name').fill(input.fullName ?? 'Sign Up Student')
  await page.getByLabel('Username').fill(input.username)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
}

/**
 * Nginx lets one IP sign up 5 times a minute with a burst of 3 (the backend's anti-guessing limit), and
 * every browser in these tests shares one IP. This keeps the tests inside that limit the way Nginx counts
 * it (a request adds 1 to a counter that drains 1 per 12 s and is refused above 3), and if a refusal still
 * happens (say the spec was just run before) it waits and tries once more.
 */
const DRAIN_MS = 12_000
const BURST = 3
let excess = 0
let lastAttempt = 0

async function pressCreateAccount(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = Date.now()
    excess = Math.max(0, excess - (now - lastAttempt) / DRAIN_MS)
    if (excess + 1 > BURST) {
      await page.waitForTimeout(Math.ceil((excess + 1 - BURST) * DRAIN_MS) + 1000)
      excess = Math.max(0, excess - (Date.now() - now) / DRAIN_MS)
    }
    excess += 1
    lastAttempt = Date.now()

    await page.getByRole('button', { name: 'Create account' }).click()
    const refused = page.getByText(
      'Too many sign-up attempts. Please wait a minute, then try again.',
    )
    // Either the server answered (an error or a redirect) or Nginx said "too many".
    await page.waitForTimeout(600)
    if (!(await refused.isVisible())) return
    excess = BURST
    lastAttempt = Date.now()
    await page.waitForTimeout(DRAIN_MS + 1000)
  }
}

async function newStudentPage(browser: Browser): Promise<Page> {
  return (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
}

// =========================================================== the main flow

test('1. admin generates a code; a student signs up with it and lands on My classes; the code works once', async ({
  browser,
}) => {
  await openCodesPage()
  const code = await generateSingle({ batch: `Single ${run}` })

  // The student finds the sign-up page from the login page.
  const student = await newStudentPage(browser)
  const first = fresh()
  await student.goto('/login')
  await student.getByRole('link', { name: 'Sign up' }).click()
  await expect(student).toHaveURL(/\/signup$/)

  // The code box formats what is typed: capitals, a dash after the fifth character.
  await student.getByLabel('Registration code').fill(code.replace('-', '').toLowerCase())
  await expect(student.getByLabel('Registration code')).toHaveValue(code)

  await fillSignup(student, { code, ...first, fullName: 'First Signup' })
  await pressCreateAccount(student)

  await expect(student).toHaveURL(/\/my\/classes$/)
  await expect(student.getByText('Welcome!')).toBeVisible()
  await expect(student.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  await expect(student.getByText('First Signup')).toBeVisible() // the sidebar shows who is signed in
  await expect(student.getByText(`@${first.username}`)).toBeVisible()

  // The same code, a second time, from another person: refused, in the words the admin asked for.
  const other = await newStudentPage(browser)
  const second = fresh()
  await other.goto('/signup')
  await fillSignup(other, { code, ...second })
  await pressCreateAccount(other)
  await expect(other.getByText(INVALID_CODE)).toBeVisible()
  await expect(other).toHaveURL(/\/signup$/)

  // And it is gone from the admin's list of unused codes (the batch no longer exists).
  await admin.reload()
  await expect(batchLink(`Single ${run}`)).toHaveCount(0)
})

// =========================================================== the form's own checks

test('2. the form checks username, password and confirmation before sending anything', async ({
  browser,
}) => {
  const page = await newStudentPage(browser)
  let sent = 0
  await page.route('**/api/v1/auth/register', (route) => {
    sent++
    return route.abort()
  })
  await page.goto('/signup')

  // No email field anywhere, and nothing is asked that is not needed.
  await expect(page.locator('input[type="email"], input[name*="email" i]')).toHaveCount(0)
  await expect(page.getByLabel(/e-?mail/i)).toHaveCount(0)

  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Enter the full 10-character registration code.')).toBeVisible()
  await expect(page.getByText('Enter your student number.')).toBeVisible()
  await expect(page.getByText('Enter your full name.')).toBeVisible()
  await expect(page.getByText(/Use 4–32 characters: lowercase letters, digits, dot/)).toBeVisible()
  await expect(page.getByText('Use at least 8 characters.')).toBeVisible()

  // Capitals are lower-cased as they are typed; a space or dash is not allowed.
  const username = page.getByLabel('Username')
  await username.fill('MariaS')
  await expect(username).toHaveValue('marias')
  await username.fill('ab')
  await page.getByLabel('Password', { exact: true }).fill('1234567')
  await page.getByLabel('Confirm password').fill('1234567')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(/Use 4–32 characters/)).toBeVisible()
  await expect(page.getByText('Use at least 8 characters.')).toBeVisible()

  // Typing in a field clears that field's complaint.
  await page.getByLabel('Password', { exact: true }).fill('12345678')
  await expect(page.getByText('Use at least 8 characters.')).toHaveCount(0)

  await page.getByLabel('Registration code').fill('ABCDE-FGHJK')
  await page.getByLabel('Student number').fill('X-1')
  await page.getByLabel('Full name').fill('Mismatch Test')
  await page.getByLabel('Username').fill('mismatch.test')
  await page.getByLabel('Confirm password').fill('12345679')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('The two passwords do not match.')).toBeVisible()
  expect(sent, 'nothing was sent while the form had problems').toBe(0)
})

test('3. the server says a username or student number is taken, next to the right field, and the code is not used up', async ({
  browser,
}) => {
  const code = await generateSingle({ batch: `Retry ${run}` })
  const student = await newStudentPage(browser)
  const mine = fresh()
  await student.goto('/signup')

  // A username that exists (a seed account).
  await fillSignup(student, { code, studentNo: mine.studentNo, username: 'student01' })
  await pressCreateAccount(student)
  const usernameField = student.getByLabel('Username')
  await expect(usernameField).toHaveAttribute('aria-invalid', 'true')
  await expect(
    student.getByText('That username is already taken. Please choose another.'),
  ).toBeVisible()
  await expect(student.getByLabel('Student number')).not.toHaveAttribute('aria-invalid', 'true')

  // A student number that exists (the test backend's student03 has E2E-03).
  await usernameField.fill(mine.username)
  await student.getByLabel('Student number').fill('E2E-03')
  await pressCreateAccount(student)
  await expect(student.getByLabel('Student number')).toHaveAttribute('aria-invalid', 'true')
  await expect(
    student.getByText('An account with this student number already exists.'),
  ).toBeVisible()

  // Neither failure used the code: with free details the same code works.
  await student.getByLabel('Student number').fill(mine.studentNo)
  await pressCreateAccount(student)
  await expect(student).toHaveURL(/\/my\/classes$/)
})

test('4. a code tied to a student number only works for that number, and its pre-filled name is used', async ({
  browser,
}) => {
  const bound = fresh()
  const code = await generateSingle({
    batch: `Bound ${run}`,
    studentNo: bound.studentNo,
    fullName: 'Pre Filled Name',
  })
  // The table says who it is for.
  await expect(admin.getByRole('row', { name: new RegExp(`Bound ${run}`) })).toContainText(
    bound.studentNo,
  )

  const student = await newStudentPage(browser)
  await student.goto('/signup')
  // Another student number: refused with the same vague message (it must not reveal which part is wrong).
  await fillSignup(student, { code, studentNo: fresh().studentNo, username: bound.username })
  await pressCreateAccount(student)
  await expect(student.getByText(INVALID_CODE)).toBeVisible()

  // The right number, a different typed name: the administrator's name wins.
  await student.getByLabel('Student number').fill(bound.studentNo)
  await student.getByLabel('Full name').fill('Something Else Typed')
  await pressCreateAccount(student)
  await expect(student).toHaveURL(/\/my\/classes$/)
  await expect(student.getByText('Pre Filled Name')).toBeVisible()
  const me = await (await student.request.get('/api/v1/auth/me')).json()
  expect(me).toMatchObject({
    full_name: 'Pre Filled Name',
    student_no: bound.studentNo,
    role: 'student',
  })
})

// =========================================================== the admin's tools

test('5. bulk codes: copy all, a CSV file and print slips (10 per A4 page); shown only once', async () => {
  const batch = `Bulk ${run}`
  await admin.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  const dialog = await openGenerate()
  await dialog.getByRole('tab', { name: 'Bulk' }).click()
  // The count and the batch name are checked first.
  await dialog.getByLabel('Number of codes (1–200)').fill('0')
  await dialog.getByRole('button', { name: 'Generate codes' }).click()
  await expect(dialog.getByText('Enter a whole number from 1 to 200.')).toBeVisible()
  await expect(dialog.getByText(/Enter a batch name/)).toBeVisible()
  await dialog.getByLabel('Number of codes (1–200)').fill('201')
  await dialog.getByRole('button', { name: 'Generate codes' }).click()
  await expect(dialog.getByText('Enter a whole number from 1 to 200.')).toBeVisible()

  await dialog.getByLabel('Number of codes (1–200)').fill('25')
  await dialog.getByLabel('Batch name').fill(batch)
  await dialog.getByRole('button', { name: 'Generate codes' }).click()

  const result = admin.getByRole('dialog', { name: 'Your registration codes' })
  await expect(result.getByText("These codes won't be shown again")).toBeVisible()
  const items = result.getByRole('list', { name: 'Registration codes' }).getByRole('listitem')
  await expect(items).toHaveCount(25)
  const codes = (await items.allInnerTexts()).map((t) => t.trim())
  expect(new Set(codes).size, 'all codes are different').toBe(25)

  // It cannot be dismissed by accident: Escape and a click outside do nothing.
  await admin.keyboard.press('Escape')
  await expect(result).toBeVisible()

  // Copy all: one code per line.
  await result.getByRole('button', { name: 'Copy all' }).click()
  await expect(result.getByRole('button', { name: 'Copied' })).toBeVisible()
  // Windows turns the line breaks into CRLF on the clipboard: compare the lines, not the breaks.
  const pasted = await admin.evaluate(() => navigator.clipboard.readText())
  expect(pasted.split(/\r?\n/)).toEqual(codes)

  // Download CSV: code, batch, student_no.
  const [download] = await Promise.all([
    admin.waitForEvent('download'),
    result.getByRole('button', { name: 'Download CSV' }).click(),
  ])
  expect(download.suggestedFilename()).toBe(`registration-codes-bulk-${run}.csv`)
  const csv = readFileSync((await download.path())!, 'utf8').replace(/^\uFEFF/, '')
  const lines = csv.trim().split(/\r?\n/)
  expect(lines[0]).toBe('code,batch,student_no')
  expect(lines.slice(1)).toEqual(codes.map((c) => `${c},${batch},`))

  // Print: 3 pages of slips (10 + 10 + 5); each slip has everything needed to sign up.
  const pages = admin.locator('.print-slips .slip-page')
  await expect(pages).toHaveCount(3)
  await expect(pages.nth(0).locator('.slip')).toHaveCount(10)
  await expect(pages.nth(1).locator('.slip')).toHaveCount(10)
  await expect(pages.nth(2).locator('.slip')).toHaveCount(5)
  const slip = admin.locator('.print-slips .slip').first()
  await expect(slip.locator('.slip-code')).toHaveText(codes[0]!)
  await expect(slip).toContainText(`Batch: ${batch}`)
  await expect(slip).toContainText('No expiry date')
  await expect(slip).toContainText(`Sign up at ${new URL(admin.url()).origin}/signup`)

  // In print the page is just the slips (the app, its dialog and toasts are hidden); on screen they are hidden.
  const screenDisplay = await admin
    .locator('.print-slips')
    .evaluate((el) => getComputedStyle(el).display)
  expect(screenDisplay).toBe('none')
  await admin.emulateMedia({ media: 'print' })
  expect(await admin.locator('.print-slips').evaluate((el) => getComputedStyle(el).display)).toBe(
    'block',
  )
  expect(await admin.locator('#root').evaluate((el) => getComputedStyle(el).display)).toBe('none')
  expect(
    await pages
      .first()
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
  ).toBe(2)
  await admin.emulateMedia({ media: 'screen' })

  // Done: the codes are forgotten (the server cannot show them again), and printing returns to normal.
  await result.getByRole('button', { name: 'Done' }).click()
  await expect(result).toBeHidden()
  await expect(admin.locator('.print-slips')).toHaveCount(0)
  expect(await admin.evaluate(() => document.body.classList.contains('printing-codes'))).toBe(false)
  await expect(admin.getByText(codes[0]!)).toHaveCount(0)
})

test('6. the table lists unused codes by their last 4 characters, filtered by batch', async () => {
  const batch = `Bulk ${run}`
  await expect(batchLink(batch)).toContainText('25 unused codes')
  await batchLink(batch).click()
  await expect(admin.getByRole('heading', { name: batch, level: 1 })).toBeVisible()

  await expect(admin.getByText('Showing 1–20 of 25')).toBeVisible()
  const rows = admin.getByRole('row').filter({ hasText: batch })
  await expect(rows).toHaveCount(20)
  // Hint only: the code itself is never in the page.
  await expect(rows.first().getByText(/^•••••-•[A-Z2-9]{4}$/)).toBeVisible()
  await expect(rows.first()).toContainText('Never') // no expiry
  await admin.getByRole('button', { name: 'Next' }).click()
  await expect(admin.getByText('Showing 21–25 of 25')).toBeVisible()
})

test('7. revoke the whole batch (the confirmation says how many), and a single code', async ({
  browser,
}) => {
  const batch = `Bulk ${run}`
  await admin.getByRole('button', { name: 'Revoke whole batch' }).click()
  const confirm = admin.getByRole('dialog', { name: 'Revoke the whole batch?' })
  await expect(confirm).toContainText('All 25 unused codes')
  await expect(confirm).toContainText(batch)
  await confirm.getByRole('button', { name: 'Revoke 25 codes' }).click()
  await expect(admin.getByText('Revoked 25 codes')).toBeVisible()
  // The batch is gone from the side bar, and the page goes back to all batches.
  await expect(batchLink(batch)).toHaveCount(0)
  await expect(admin).toHaveURL(/\/admin\/registration-codes$/)

  // A single code: revoke it, then it no longer works.
  const code = await generateSingle({ batch: `Revoke ${run}` })
  const row = admin.getByRole('row').filter({ hasText: `Revoke ${run}` })
  await row.getByRole('button', { name: /^Revoke the code ending in/ }).click()
  const one = admin.getByRole('dialog', { name: 'Revoke this code?' })
  await expect(one).toContainText(`Revoke ${run}`)
  await one.getByRole('button', { name: 'Revoke code' }).click()
  await expect(admin.getByText('Code revoked')).toBeVisible()
  await expect(admin.getByRole('row').filter({ hasText: `Revoke ${run}` })).toHaveCount(0)

  const student = await newStudentPage(browser)
  await student.goto('/signup')
  await fillSignup(student, { code, ...fresh() })
  await pressCreateAccount(student)
  await expect(student.getByText(INVALID_CODE)).toBeVisible()
})

test('8. an expiry in the past is refused; the sign-up page and Registration Codes are only for the right people', async ({
  browser,
}) => {
  const dialog = await openGenerate()
  await dialog.getByLabel('Batch name').fill(`Past ${run}`)
  await dialog.getByLabel('Expires (optional)').fill('2020-01-01T08:00')
  await dialog.getByRole('button', { name: 'Generate code' }).click()
  await expect(dialog.getByText('Choose a time in the future.')).toBeVisible()
  await expect(dialog.locator('input[type="email"], input[name*="email" i]')).toHaveCount(0)
  await admin.keyboard.press('Escape')

  // A student signed in: no admin screens, no sidebar entry, and /signup sends them home.
  const student = await newStudentPage(browser)
  const mine = fresh()
  const code = await generateSingle({ batch: `Guard ${run}` })
  await student.goto('/signup')
  await fillSignup(student, { code, ...mine })
  await pressCreateAccount(student)
  await expect(student).toHaveURL(/\/my\/classes$/)
  await expect(
    student
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Registration Codes' }),
  ).toHaveCount(0)
  await student.goto('/admin/registration-codes')
  await expect(student).toHaveURL(/\/my\/classes$/)
  await student.goto('/signup')
  await expect(student).toHaveURL(/\/my\/classes$/)
})

test('9. too many attempts (429) is explained in plain words, and what was typed is kept', async ({
  browser,
}) => {
  const page = await newStudentPage(browser)
  await page.route('**/api/v1/auth/register', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Too many requests, slow down', code: 'RATE_LIMITED' }),
    }),
  )
  await page.goto('/signup')
  const mine = fresh()
  await fillSignup(page, { code: 'ABCDE-FGHJK', ...mine, fullName: 'Kept Name' })
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(
    page.getByRole('alert').filter({
      hasText: 'Too many sign-up attempts. Please wait a minute, then try again.',
    }),
  ).toBeVisible()
  await expect(page.getByLabel('Full name')).toHaveValue('Kept Name')
  await expect(page.getByLabel('Username')).toHaveValue(mine.username)
  await expect(page).toHaveURL(/\/signup$/)
})
