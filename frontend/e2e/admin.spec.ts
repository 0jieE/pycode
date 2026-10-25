import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** The single administrator lands on Users > Students. */
async function adminPage(page: Page) {
  const admin = account('admin')
  await signIn(page, admin.username, admin.password)
  await expect(page.getByRole('heading', { name: 'Students', level: 1 })).toBeVisible()
}

/** New accounts are made on the Instructors tab; the form starts as an instructor. */
async function openNewInstructor(page: Page) {
  await page.goto('/admin/users/instructors')
  await page.getByRole('button', { name: 'New instructor' }).click()
  return page.getByRole('dialog', { name: 'New instructor' })
}

// Unique per run so reruns never collide with accounts from earlier runs.
const run = Date.now().toString(36)

test.describe.configure({ mode: 'serial' })

test('admin creates an instructor, who can then sign in', async ({ page, browser }) => {
  const username = `e2e.new.${run}`
  await adminPage(page)

  const dialog = await openNewInstructor(page)
  // One administrator only, and students sign up with a code: this form makes instructors.
  await expect(dialog.getByLabel('Role')).toHaveValue('instructor')
  await expect(dialog.getByLabel('Role').locator('option')).toHaveText(['Instructor'])
  await dialog.getByLabel('Full name').fill('E2E Created Instructor')
  await dialog.getByLabel('Username').fill(username)
  await dialog.getByLabel('Temporary password').fill('Passw0rd-created')
  await dialog.getByRole('button', { name: 'Create instructor' }).click()
  await expect(page.getByText('User created')).toBeVisible()

  await page.getByLabel('Search').fill(username)
  await expect(page.getByRole('row', { name: new RegExp(username) })).toBeVisible()

  const other = await (await browser.newContext()).newPage()
  await signIn(other, username, 'Passw0rd-created')
  await expect(other).toHaveURL(/\/classes$/)
})

test('the Students tab has no New or Import buttons: students sign up with a code', async ({
  page,
}) => {
  await adminPage(page)
  await expect(page.getByRole('row', { name: /student01/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^New/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Import/ })).toHaveCount(0)
  await page.goto('/admin/users/instructors')
  await expect(page.getByRole('button', { name: 'New instructor' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Import/ })).toHaveCount(0)
})

test('a taken username is reported next to the field', async ({ page }) => {
  await adminPage(page)
  const dialog = await openNewInstructor(page)
  await dialog.getByLabel('Full name').fill('Duplicate')
  await dialog.getByLabel('Username').fill('student01')
  await dialog.getByLabel('Temporary password').fill('Passw0rd-dup1')
  await dialog.getByRole('button', { name: 'Create instructor' }).click()
  await expect(dialog.getByText('Username is already taken')).toBeVisible()
})

test('reset password shows the new password once; the old one stops working', async ({
  page,
  browser,
}) => {
  const username = `e2e.reset.${run}`
  await adminPage(page)

  // Create a throwaway account so no seed account is touched.
  const form = await openNewInstructor(page)
  await form.getByLabel('Full name').fill('E2E Reset Target')
  await form.getByLabel('Username').fill(username)
  await form.getByLabel('Temporary password').fill('Passw0rd-before')
  await form.getByRole('button', { name: 'Create instructor' }).click()
  await expect(page.getByText('User created')).toBeVisible()

  await page.getByLabel('Search').fill(username)
  // This run's account (a same-named one from an earlier run may exist): its own row.
  const target = page.getByRole('row', { name: new RegExp(username) })
  await target.getByRole('button', { name: 'Reset password for E2E Reset Target' }).click()
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

test('deactivate blocks sign-in until activated', async ({ page, browser }) => {
  const username = `e2e.off.${run}`
  await adminPage(page)

  const form = await openNewInstructor(page)
  await form.getByLabel('Full name').fill('E2E Deactivate Target')
  await form.getByLabel('Username').fill(username)
  await form.getByLabel('Temporary password').fill('Passw0rd-toggle')
  await form.getByRole('button', { name: 'Create instructor' }).click()
  await expect(page.getByText('User created')).toBeVisible()

  await page.getByLabel('Search').fill(username)
  const row = page.getByRole('row', { name: new RegExp(username) })
  await row.getByRole('button', { name: 'Deactivate E2E Deactivate Target' }).click()
  await page
    .getByRole('dialog', { name: 'Deactivate this account?' })
    .getByRole('button', { name: 'Deactivate' })
    .click()
  await expect(row.getByText('Inactive')).toBeVisible()

  const other = await (await browser.newContext()).newPage()
  await signIn(other, username, 'Passw0rd-toggle')
  await expect(other.getByRole('alert')).toContainText('disabled')

  await row.getByRole('button', { name: 'Activate E2E Deactivate Target' }).click()
  await expect(row.getByText('Active', { exact: true })).toBeVisible()
  await signIn(other, username, 'Passw0rd-toggle')
  await expect(other).toHaveURL(/\/classes$/)
})

test('the side bar lists instructors and students only, with pagination', async ({ page }) => {
  await adminPage(page)
  const roles = page.getByRole('navigation', { name: 'Users list' })
  // The administrator is the only admin and is not listed.
  await expect(roles.getByRole('link')).toHaveCount(2)
  await expect(roles.getByRole('link').nth(0)).toHaveText(/^Instructors\d+$/)
  await expect(roles.getByRole('link').nth(1)).toHaveText(/^Students\d+$/)
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
