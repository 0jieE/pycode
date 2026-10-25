import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { account } from './accounts'

/**
 * My account for every role, and the forced password change after an admin reset. The users are made
 * through the API (so each run has its own); everything the users do goes through the UI.
 */

const run = Date.now().toString(36)
const PASSWORD = 'Passw0rd-first1'
const TEMPORARY = 'Passw0rd-temp-reset'
const NEW_PASSWORD = 'Passw0rd-second2'
const OTHER_USERNAME = `taken.${run}`
const USERNAME = `acct.${run}`
const RENAMED = `ren.${run}`

let adminApi: APIRequestContext
let student: Page
let studentId = 0

async function createUser(body: {
  username: string
  full_name: string
  role: string
  student_no?: string
}): Promise<number> {
  const res = await adminApi.post('/api/v1/users', { data: { ...body, password: PASSWORD } })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()).id as number
}

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe.configure({ mode: 'serial', timeout: 90_000 })

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  adminApi = await playwright.request.newContext({ baseURL })
  const a = account('admin')
  const login = await adminApi.post('/api/v1/auth/login', {
    data: { username: a.username, password: a.password },
  })
  expect(login.ok()).toBeTruthy()

  studentId = await createUser({
    username: USERNAME,
    full_name: 'Account Student',
    role: 'student',
    student_no: `ACC-${run}`,
  })
  await createUser({
    username: OTHER_USERNAME,
    full_name: 'Someone Else',
    role: 'student',
    student_no: `OTH-${run}`,
  })

  student = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await signIn(student, USERNAME, PASSWORD)
  await expect(student.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
})

test('1. My account opens from the account menu, and shows what only an administrator can change', async () => {
  await student.getByRole('button', { name: /^Account menu/ }).click()
  await student.getByRole('menuitem', { name: 'My account' }).click()
  await expect(student).toHaveURL(/\/account$/)
  await expect(student.getByRole('heading', { name: 'My account', level: 1 })).toBeVisible()

  await expect(student.getByLabel('Full name')).toHaveValue('Account Student')
  await expect(student.getByLabel('Username')).toHaveValue(USERNAME)
  // Read only: role, student number, whether the account is active.
  const profile = student.getByRole('region', { name: 'Profile' })
  await expect(profile.getByText('Student', { exact: true })).toBeVisible()
  await expect(profile.getByText(`ACC-${run}`)).toBeVisible()
  await expect(profile.getByText('Active', { exact: true })).toBeVisible()
  await expect(profile.getByLabel('Student number')).toHaveCount(0)
  // Nothing to save until something changes.
  await expect(profile.getByRole('button', { name: 'Save changes' })).toBeDisabled()
})

test('2. the profile is checked before sending, a taken username is refused, and a good change shows everywhere', async () => {
  const profile = student.getByRole('region', { name: 'Profile' })

  await profile.getByLabel('Username').fill('abc')
  await profile.getByRole('button', { name: 'Save changes' }).click()
  await expect(profile.getByText(/4–32 characters/).first()).toBeVisible()

  await profile.getByLabel('Full name').fill('   ')
  await profile.getByLabel('Username').fill(USERNAME)
  await profile.getByRole('button', { name: 'Save changes' }).click()
  await expect(profile.getByText('Enter your full name.')).toBeVisible()

  // Someone else's username: the server's 409, next to the field.
  await profile.getByLabel('Full name').fill('Account Student')
  await profile.getByLabel('Username').fill(OTHER_USERNAME)
  await profile.getByRole('button', { name: 'Save changes' }).click()
  await expect(profile.getByText('That username is already taken. Choose another.')).toBeVisible()

  // A real change: typed in capitals, kept lower case, and the top bar follows without signing in again.
  await profile.getByLabel('Full name').fill('Renamed Student')
  await profile.getByLabel('Username').fill(RENAMED.toUpperCase())
  await expect(profile.getByLabel('Username')).toHaveValue(RENAMED)
  await profile.getByRole('button', { name: 'Save changes' }).click()
  await expect(student.getByText('Profile updated')).toBeVisible()
  const topbar = student.getByRole('banner')
  await expect(topbar.getByText('Renamed Student')).toBeVisible()
  await expect(topbar.getByText(`@${RENAMED}`)).toBeVisible()
  await expect(profile.getByRole('button', { name: 'Save changes' })).toBeDisabled()

  // Still signed in after the reload, under the new name.
  await student.reload()
  await expect(topbar.getByText(`@${RENAMED}`)).toBeVisible()
})

test('3. changing the password: checks, the wrong current password, success, and the new password is the one that works', async ({
  browser,
}) => {
  const box = student.getByRole('region', { name: 'Password' })
  const current = box.getByLabel('Current password')
  const next = box.getByLabel('New password', { exact: true })
  const confirm = box.getByLabel('Confirm new password')
  const submit = box.getByRole('button', { name: 'Change password' })

  // Checked here, never sent: too short, the same, typed differently twice.
  await current.fill(PASSWORD)
  await next.fill('short')
  await confirm.fill('short')
  await submit.click()
  await expect(box.getByText('The new password needs at least 8 characters.')).toBeVisible()

  await next.fill(PASSWORD)
  await confirm.fill(PASSWORD)
  await submit.click()
  await expect(
    box.getByText('The new password must be different from the current one.'),
  ).toBeVisible()

  await next.fill(NEW_PASSWORD)
  await confirm.fill('Passw0rd-different3')
  await submit.click()
  await expect(box.getByText('The two passwords do not match.')).toBeVisible()

  // The server's answer to a wrong current password, next to that field.
  await current.fill('not-my-password')
  await confirm.fill(NEW_PASSWORD)
  await submit.click()
  await expect(box.getByText('The current password is not right.')).toBeVisible()

  // The real change: this device stays signed in, the form empties.
  await current.fill(PASSWORD)
  await submit.click()
  await expect(student.getByText('Password changed. Other devices were signed out.')).toBeVisible()
  await expect(current).toHaveValue('')
  await student.reload()
  await expect(student.getByRole('heading', { name: 'My account', level: 1 })).toBeVisible()

  // The old password no longer works; the new one does.
  const other = await (await browser.newContext()).newPage()
  await signIn(other, RENAMED, PASSWORD)
  await expect(other.getByText(/Invalid|incorrect|wrong/i).first()).toBeVisible()
  await signIn(other, RENAMED, NEW_PASSWORD)
  await expect(other.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
})

test('4. after an admin reset, signing in leads straight to "Change your password", and nothing else opens until it is done', async ({
  browser,
}) => {
  const reset = await adminApi.post(`/api/v1/users/${studentId}/reset-password`, {
    data: { temporary_password: TEMPORARY },
  })
  expect(reset.ok(), await reset.text()).toBeTruthy()
  const temporary = ((await reset.json()) as { temporary_password: string }).temporary_password

  const fresh = await (await browser.newContext()).newPage()
  await signIn(fresh, RENAMED, temporary)
  await expect(fresh).toHaveURL(/\/change-password$/)
  await expect(fresh.getByRole('heading', { name: 'Change your password', level: 1 })).toBeVisible()

  // Every other page sends the user back here.
  await fresh.goto('/my/classes')
  await expect(fresh).toHaveURL(/\/change-password$/)
  await fresh.goto('/account')
  await expect(fresh).toHaveURL(/\/change-password$/)

  await fresh.getByLabel('Current password').fill(temporary)
  await fresh.getByLabel('New password', { exact: true }).fill('Passw0rd-third3')
  await fresh.getByLabel('Confirm new password').fill('Passw0rd-third3')
  await fresh.getByRole('button', { name: 'Change password' }).click()

  // No new sign-in needed: the user moves on to their own pages.
  await expect(fresh).toHaveURL(/\/my\/classes$/)
  await expect(fresh.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
})

test('5. instructors and administrators have the page too', async ({ browser }) => {
  const instructorName = `inst.${run}`
  await createUser({
    username: instructorName,
    full_name: 'Account Instructor',
    role: 'instructor',
  })
  const ins = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await signIn(ins, instructorName, PASSWORD)
  await expect(ins.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()
  await ins.getByRole('button', { name: /^Account menu: Account Instructor/ }).click()
  await ins.getByRole('menuitem', { name: 'My account' }).click()
  await expect(ins.getByRole('heading', { name: 'My account', level: 1 })).toBeVisible()
  await expect(
    ins.getByRole('region', { name: 'Profile' }).getByText('Instructor', { exact: true }),
  ).toBeVisible()

  // The administrator's own frame, with the account block of its side bar.
  const adminUser = account('admin')
  const admin = await (
    await browser.newContext({ viewport: { width: 1366, height: 768 } })
  ).newPage()
  await signIn(admin, adminUser.username, adminUser.password)
  await expect(admin.getByRole('heading', { name: 'Students', level: 1 })).toBeVisible()
  await admin.getByRole('button', { name: /^Account menu: System Administrator/ }).click()
  await admin.getByRole('menuitem', { name: 'My account' }).click()
  await expect(admin.getByRole('heading', { name: 'My account', level: 1 })).toBeVisible()
  await expect(
    admin.getByRole('region', { name: 'Profile' }).getByText('Administrator', { exact: true }),
  ).toBeVisible()
})
