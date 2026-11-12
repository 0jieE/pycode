import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'

/**
 * The admin deletes accounts from the Instructors and Students pages: a throwaway student made here is deleted
 * (after typing their username), and an instructor who still has classes is refused (nothing is deleted).
 */

const ADMIN = account('admin')
const BLOCKED = account('instructor2') // owns classes in the test seed

let page: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await page.goto('/login')
  await page.getByLabel('Username').fill(ADMIN.username)
  await page.getByLabel('Password').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Students', level: 1 })).toBeVisible()
})

const counts = async () =>
  (await (await page.request.get('/api/v1/users/counts')).json()) as {
    instructors: number
    students: number
  }

test('1. a student is deleted after typing their username', async () => {
  const run = Date.now().toString(36)
  const username = `e2e-del-${run}`
  const fullName = `Delete Me ${run}`
  const made = await page.request.post('/api/v1/users', {
    data: {
      username,
      full_name: fullName,
      password: `Temp-${run}-pass`,
      role: 'student',
      student_no: `DEL-${run}`,
    },
  })
  expect(made.status(), await made.text()).toBe(201)
  const before = await counts()

  await page.goto('/admin/users/students')
  await page.getByLabel('Search').fill(username)
  await page.getByRole('button', { name: `Delete ${fullName}`, exact: true }).click()

  const dialog = page.getByRole('dialog', { name: `Delete ${fullName}?` })
  await expect(dialog.getByText(/will be signed out and deleted for good/)).toBeVisible()
  await expect(dialog.getByText('This cannot be undone.')).toBeVisible()
  const confirm = dialog.getByRole('button', { name: 'Delete account' })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(`Type ${username} to confirm`).fill('not-them')
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(`Type ${username} to confirm`).fill(username)
  await confirm.click()

  await expect(page.getByText(`${fullName} was deleted`)).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('No one matches')).toBeVisible()
  expect((await counts()).students).toBe(before.students - 1)
  const left = (await (await page.request.get(`/api/v1/users?q=${username}`)).json()) as {
    total: number
  }
  expect(left.total).toBe(0)
})

test('2. an instructor who still has classes cannot be deleted', async () => {
  const found = (await (await page.request.get(`/api/v1/users?q=${BLOCKED.username}`)).json())
    .items as { username: string; full_name: string }[]
  const me = found.find((u) => u.username === BLOCKED.username)!

  await page.goto('/admin/users/instructors')
  await page.getByLabel('Search').fill(BLOCKED.username)
  await page
    .getByRole('button', { name: `Delete ${me.full_name}`, exact: true })
    .first()
    .click()

  const dialog = page.getByRole('dialog', { name: `Delete ${me.full_name}?` })
  await expect(dialog.getByText('This account can’t be deleted yet:')).toBeVisible()
  await expect(dialog.getByRole('listitem').filter({ hasText: /class/i }).first()).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Delete account' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
})
