import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'

/**
 * Lessons staff add can be deleted; lessons that came with the system can only be hidden or reset.
 */

const run = Date.now().toString(36)
const TITLE = `E2E lesson ${run}`

let page: Page
const lessonList = () => page.getByRole('complementary', { name: 'Lessons' })

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  const a = account('instructor2')
  await page.goto('/login')
  await page.getByLabel('Username').fill(a.username)
  await page.getByLabel('Password').fill(a.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()
})

test('a lesson an instructor added can be deleted', async () => {
  await page.goto('/tutorial')
  await lessonList().getByRole('button', { name: 'Add a lesson' }).click()
  const dialog = page.getByRole('dialog', { name: 'New lesson' })
  await dialog.getByLabel('Title').fill(TITLE)
  await dialog.getByRole('button', { name: 'Create lesson' }).click()
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
  const slug = page.url().split('/').pop()!

  await expect(page.getByRole('button', { name: 'Reset to default' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Delete lesson' }).click()
  await page
    .getByRole('dialog', { name: 'Delete this lesson?' })
    .getByRole('button', { name: 'Delete lesson' })
    .click()

  await expect(page).toHaveURL(/\/tutorial$/)
  await expect(page.getByText(`"${TITLE}" was deleted`)).toBeVisible()
  await expect(lessonList().getByRole('link', { name: new RegExp(TITLE) })).toHaveCount(0)
  expect((await page.request.get(`/api/v1/tutorial/manage/lessons/${slug}`)).status()).toBe(404)
})

test('a lesson that came with the system has Reset, not Delete', async () => {
  await page.goto('/tutorial/print')
  await expect(page.getByRole('heading', { level: 1, name: 'Printing output' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reset to default' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete lesson' })).toHaveCount(0)
})
