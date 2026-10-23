import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function adminPage(page: Page) {
  const admin = account('admin')
  await signIn(page, admin.username, admin.password)
  await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible()
}

// Unique per run so reruns never collide with accounts from earlier runs.
const run = Date.now().toString(36)

test.describe.configure({ mode: 'serial' })

test('admin creates a user, who can then sign in', async ({ page, browser }) => {
  const username = `e2e.new.${run}`
  await adminPage(page)

  await page.getByRole('button', { name: 'New user' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create user' })
  await dialog.getByLabel('Full name').fill('E2E Created Student')
  await dialog.getByLabel('Username').fill(username)
  await dialog.getByLabel('Student number').fill(`E2E-${run}`)
  await dialog.getByLabel('Temporary password').fill('Passw0rd-created')
  await dialog.getByRole('button', { name: 'Create user' }).click()
  await expect(page.getByText('User created')).toBeVisible()

  await page.getByLabel('Search').fill(username)
  await expect(page.getByRole('row', { name: new RegExp(username) })).toBeVisible()

  const other = await (await browser.newContext()).newPage()
  await signIn(other, username, 'Passw0rd-created')
  await expect(other).toHaveURL(/\/my\/classes$/)
})

test('a taken username is reported next to the field', async ({ page }) => {
  await adminPage(page)
  await page.getByRole('button', { name: 'New user' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create user' })
  await dialog.getByLabel('Full name').fill('Duplicate')
  await dialog.getByLabel('Username').fill('student01')
  await dialog.getByLabel('Temporary password').fill('Passw0rd-dup1')
  await dialog.getByRole('button', { name: 'Create user' }).click()
  await expect(dialog.getByText('Username is already taken')).toBeVisible()
})

test('imported students can sign in; the preview flags bad rows; the result lists skipped rows', async ({
  page,
  browser,
}) => {
  const good = `e2e.imp.${run}`
  const csv = [
    'student_no,full_name,username,temp_password',
    `I-${run}-1,Imported One,${good},Passw0rd-import`,
    `I-${run}-2,Bad Username,x,Passw0rd-import`,
    `I-${run}-3,Existing Account,student01,Passw0rd-import`,
  ].join('\n')

  await adminPage(page)
  await page.getByRole('button', { name: 'Import CSV' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import students from CSV' })
  await dialog.getByLabel('CSV file').setInputFiles({
    name: 'students.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })

  // Client-side preview: the short username is caught before uploading.
  await expect(dialog.getByText('2 ready to import')).toBeVisible()
  await expect(dialog.getByText('1 with problems')).toBeVisible()
  await expect(dialog.getByText(/username must be 3-64 characters/)).toBeVisible()

  await dialog.getByRole('button', { name: 'Import 2 students' }).click()

  // The backend's own result: the short username is invalid and student01 already exists.
  await expect(dialog.getByText('1 account created')).toBeVisible()
  await expect(dialog.getByText('2 skipped')).toBeVisible()
  await expect(dialog.getByText('username already exists')).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()

  const other = await (await browser.newContext()).newPage()
  await signIn(other, good, 'Passw0rd-import')
  // The password from the CSV is temporary: the first sign-in asks for a new one.
  await expect(other).toHaveURL(/\/change-password$/)
})

test('a CSV without the right columns is rejected in the dialog', async ({ page }) => {
  await adminPage(page)
  await page.getByRole('button', { name: 'Import CSV' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import students from CSV' })
  await dialog.getByLabel('CSV file').setInputFiles({
    name: 'wrong.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,user\nA,b\n'),
  })
  await expect(dialog.getByRole('alert')).toContainText('missing these columns')
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
})

test('reset password shows the new password once; the old one stops working', async ({
  page,
  browser,
}) => {
  const username = `e2e.reset.${run}`
  await adminPage(page)

  // Create a throwaway user so no seed account is touched.
  await page.getByRole('button', { name: 'New user' }).click()
  const form = page.getByRole('dialog', { name: 'Create user' })
  await form.getByLabel('Full name').fill('E2E Reset Target')
  await form.getByLabel('Username').fill(username)
  await form.getByLabel('Temporary password').fill('Passw0rd-before')
  await form.getByRole('button', { name: 'Create user' }).click()
  await expect(page.getByText('User created')).toBeVisible()

  await page.getByLabel('Search').fill(username)
  await page.getByRole('button', { name: 'Reset password for E2E Reset Target' }).click()
  await page
    .getByRole('dialog', { name: 'Reset password?' })
    .getByRole('button', { name: 'Reset password' })
    .click()

  const shown = page.getByRole('dialog', { name: 'New temporary password' })
  const newPassword = await shown.getByLabel('Temporary password').inputValue()
  expect(newPassword.length).toBeGreaterThanOrEqual(8)
  await expect(shown.getByText('shown only once')).toBeVisible()
  await shown.getByRole('button', { name: 'Done' }).click()
  await expect(shown).toBeHidden()

  const other = await (await browser.newContext()).newPage()
  await signIn(other, username, 'Passw0rd-before')
  await expect(other.getByRole('alert')).toContainText('Invalid username or password')
  await signIn(other, username, newPassword)
  // The new password is temporary: the first sign-in asks for a password of the user's own.
  await expect(other).toHaveURL(/\/change-password$/)
})

test('deactivate blocks sign-in until activated; you cannot deactivate yourself', async ({
  page,
  browser,
}) => {
  const username = `e2e.off.${run}`
  await adminPage(page)

  await page.getByRole('button', { name: 'New user' }).click()
  const form = page.getByRole('dialog', { name: 'Create user' })
  await form.getByLabel('Full name').fill('E2E Deactivate Target')
  await form.getByLabel('Username').fill(username)
  await form.getByLabel('Temporary password').fill('Passw0rd-toggle')
  await form.getByRole('button', { name: 'Create user' }).click()
  await expect(page.getByText('User created')).toBeVisible()

  await page.getByLabel('Search').fill(username)
  await page.getByRole('button', { name: 'Deactivate E2E Deactivate Target' }).click()
  await page
    .getByRole('dialog', { name: 'Deactivate this account?' })
    .getByRole('button', { name: 'Deactivate' })
    .click()
  const row = page.getByRole('row', { name: new RegExp(username) })
  await expect(row.getByText('Inactive')).toBeVisible()

  const other = await (await browser.newContext()).newPage()
  await signIn(other, username, 'Passw0rd-toggle')
  await expect(other.getByRole('alert')).toContainText('disabled')

  await page.getByRole('button', { name: 'Activate E2E Deactivate Target' }).click()
  await expect(row.getByText('Active', { exact: true })).toBeVisible()
  await signIn(other, username, 'Passw0rd-toggle')
  await expect(other).toHaveURL(/\/my\/classes$/)

  // The admin's own row has Deactivate switched off.
  await page.getByLabel('Search').fill('admin')
  const ownRow = page.locator('tr', { has: page.getByText('admin', { exact: true }) })
  await expect(ownRow.getByRole('button', { name: /^Deactivate/ })).toBeDisabled()
})

test('the side bar lists users by role, with pagination', async ({ page }) => {
  await adminPage(page)
  const roles = page.getByRole('navigation', { name: 'Users list' })
  await roles.getByRole('link', { name: /^Instructors/ }).click()
  await expect(page.getByRole('heading', { name: 'Instructors', level: 1 })).toBeVisible()
  await expect(page.getByRole('row', { name: /instructor1/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /student01/ })).toHaveCount(0)

  await roles.getByRole('link', { name: /^Students/ }).click()
  await expect(page).toHaveURL(/\/admin\/users\/students$/)
  await expect(page.getByText(/Page 1 of \d+/)).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText(/Page 2 of \d+/)).toBeVisible()
})
