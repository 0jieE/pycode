import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'

/**
 * The frame of the instructor pages: the fixed icon strip, the top bar on every page, and the class list on
 * the left that opens a class in the page.
 */

const run = Date.now().toString(36)
const CLASS_NAME = `Frame Class ${run}`

let page: Page
let classId = 0

const strip = () => page.getByRole('navigation', { name: 'Main' })
const classList = () => page.getByRole('complementary', { name: 'Your classes' })
const topbar = () => page.getByRole('banner')

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  const a = account('instructor2')
  await page.goto('/login')
  await page.getByLabel('Username').fill(a.username)
  await page.getByLabel('Password').fill(a.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()

  const made = await page.request.post('/api/v1/classes', {
    data: { name: CLASS_NAME, year_and_section: 'BSIT F-1', school_year: '2026-2027' },
  })
  expect(made.ok()).toBeTruthy()
  classId = (await made.json()).id as number
})

test('the icon strip is fixed, and the top bar says where you are and who you are', async () => {
  await page.goto('/classes')
  const bar = strip().locator('xpath=..')
  await page.mouse.move(700, 400)
  expect((await bar.boundingBox())!.width).toBe(48)
  await bar.hover()
  await page.waitForTimeout(400)
  expect((await bar.boundingBox())!.width).toBe(48)
  await expect(strip().getByRole('link')).toHaveText([
    'Classes',
    'Labs',
    'Python Tutorial',
    'My workspace',
  ])

  await expect(topbar().getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Classes')
  await expect(topbar().getByText('Instructor Two')).toBeVisible()
  await expect(topbar().getByText('@instructor2')).toBeVisible()
})

test('until a class is chosen the page says so, and the list on the left opens one', async () => {
  await page.goto('/classes')
  await expect(page.getByText('Select a class from the list on the left to open it.')).toBeVisible()

  const link = classList().getByRole('link', { name: new RegExp(CLASS_NAME) })
  await expect(link).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/classes/${classId}$`))
  await expect(page.getByRole('heading', { name: CLASS_NAME, level: 1 })).toBeVisible()
  await expect(link).toHaveAttribute('aria-current', 'page')
  await expect(topbar().getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    `Classes${CLASS_NAME}`,
  )
})

test('deeper pages keep the frame, and the path names where you are', async () => {
  await page.goto(`/classes/${classId}/activities/new`)
  await expect(page.getByRole('heading', { name: 'New activity', level: 1 })).toBeVisible()
  await expect(classList()).toBeVisible()
  await expect(strip()).toBeVisible()
  await expect(topbar().getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    `Classes${CLASS_NAME}New activity`,
  )

  // The class in the path leads back to it.
  await topbar().getByRole('link', { name: CLASS_NAME }).click()
  await expect(page.getByRole('heading', { name: CLASS_NAME, level: 1 })).toBeVisible()
})

test('the + creates a class, and Archive hides it from the list until archived classes are shown', async () => {
  await classList().getByRole('button', { name: 'Create a class' }).click()
  await expect(page.getByRole('dialog', { name: 'New class' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'New class' })).toBeHidden()

  await page.goto(`/classes/${classId}`)
  await page.getByRole('button', { name: `Archive ${CLASS_NAME}` }).click()
  await page
    .getByRole('dialog', { name: 'Archive this class?' })
    .getByRole('button', { name: 'Archive' })
    .click()
  await expect(page.getByText(`${CLASS_NAME} was archived`)).toBeVisible()
  await expect(classList().getByRole('link', { name: new RegExp(CLASS_NAME) })).toHaveCount(0)

  await classList().getByRole('button', { name: 'Show archived' }).click()
  await expect(classList().getByRole('link', { name: new RegExp(CLASS_NAME) })).toContainText(
    'Archived',
  )
})

test('instructors have their own Practice workspace, the same IDE as students', async () => {
  await strip().getByRole('link', { name: 'My workspace' }).click()
  await expect(page).toHaveURL(/\/practice$/)
  await expect(topbar().getByRole('heading', { name: 'My workspace', level: 1 })).toBeVisible()
  await expect(
    page.getByRole('banner').getByRole('heading', { name: 'My workspace', level: 1 }),
  ).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Your files' })).toBeVisible()
  // No class, so nothing of a class: no class list, no Submit.
  await expect(classList()).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Submit/ })).toHaveCount(0)

  // It works: make a file, run it.
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New file' })
  const name = `try_${run}.py`
  await dialog.getByLabel('File name').fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.type("print('instructor practice ok')")
  await page.getByLabel('File to run').selectOption(name)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('log', { name: 'Program output' })).toContainText(
    'instructor practice ok',
    { timeout: 30_000 },
  )
})
