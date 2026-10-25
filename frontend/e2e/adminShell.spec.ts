import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'

/**
 * The administrator's frame, the same as the other roles': the fixed icon strip, the top bar on every page, and
 * the list of labs as a second side bar on the Labs pages.
 */

let page: Page

const strip = () => page.getByRole('navigation', { name: 'Main' })
const topbar = () => page.getByRole('banner')
const labList = () => page.getByRole('complementary', { name: 'Labs' })

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  const a = account('admin')
  await page.goto('/login')
  await page.getByLabel('Username').fill(a.username)
  await page.getByLabel('Password').fill(a.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Students', level: 1 })).toBeVisible()
})

test('the icon strip is fixed, and the top bar says where you are', async () => {
  const bar = strip().locator('xpath=..')
  await page.mouse.move(700, 400)
  expect((await bar.boundingBox())!.width).toBe(48)
  await bar.hover()
  await page.waitForTimeout(400)
  expect((await bar.boundingBox())!.width).toBe(48)
  await expect(strip().getByRole('link')).toHaveText([
    'Users',
    'Registration Codes',
    'Labs',
    'Storage',
    'Python Tutorial',
  ])

  await expect(topbar().getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Users')
  await strip().getByRole('link', { name: 'Registration Codes' }).click()
  await expect(page).toHaveURL(/\/admin\/registration-codes$/)
  await expect(topbar().getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    'Registration Codes',
  )
})

test('Labs lists the rooms on the left; the page asks to choose one, and + makes a new one', async () => {
  await strip().getByRole('link', { name: 'Labs' }).click()
  await expect(page).toHaveURL(/\/labs$/)
  await expect(labList()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Labs', level: 1 })).toBeVisible()

  await labList().getByRole('button', { name: 'Create a lab' }).click()
  await expect(page.getByRole('dialog', { name: 'New lab' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'New lab' })).toBeHidden()

  // Clicking the active icon again hides the list, like the other roles' pages.
  await strip().getByRole('link', { name: 'Labs' }).click()
  await expect(labList()).toBeHidden()
  await strip().getByRole('link', { name: 'Labs' }).click()
  await expect(labList()).toBeVisible()
})

test('a lab is a named room: add it, rename it, delete it', async () => {
  const name = `E2E Room ${Date.now().toString(36)}`
  await page.goto('/labs')
  await labList().getByRole('button', { name: 'Create a lab' }).click()
  const create = page.getByRole('dialog', { name: 'New lab' })
  await create.getByLabel('Lab name').fill(name)
  await create.getByRole('button', { name: 'Create lab' }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
  await expect(labList().getByRole('link', { name })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Upcoming sessions' })).toBeVisible()

  await page.getByRole('button', { name: 'Rename' }).click()
  const rename = page.getByRole('dialog', { name: 'Rename lab' })
  await rename.getByLabel('Lab name').fill(`${name} B`)
  await rename.getByRole('button', { name: 'Rename' }).click()
  await expect(page.getByRole('heading', { name: `${name} B`, level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Delete' }).click()
  await page
    .getByRole('dialog', { name: `Delete ${name} B?` })
    .getByRole('button', { name: 'Delete lab' })
    .click()
  await expect(page).toHaveURL(/\/labs$/)
  await expect(labList().getByRole('link', { name: `${name} B` })).toHaveCount(0)
})
