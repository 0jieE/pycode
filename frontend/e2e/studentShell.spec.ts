import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { account } from './accounts'
import { approveAll, createLab, join, type Lab } from './lab'

/**
 * The frame of the student pages: the top bar on every page, the icon strip that never opens, and the class
 * list on the left of the pages that are not the IDE.
 */

const run = Date.now().toString(36)
const CLASS_NAME = `Shell Class ${run}`
const OTHER_CLASS = `Shell Other ${run}`
const TITLE = `Shell Lab ${run}`
const STUDENT = 'student15'

let stu: Page
let ins: APIRequestContext
let lab: Lab
let other: Lab

const strip = () => stu.getByRole('navigation', { name: 'Main' })
const classList = () => stu.getByRole('complementary', { name: 'Your classes' })
const topbar = () => stu.getByRole('banner')

test.describe.configure({ mode: 'serial', timeout: 90_000 })

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  ins = await playwright.request.newContext({ baseURL })
  const login = await ins.post('/api/v1/auth/login', {
    data: { username: 'instructor2', password: account('instructor2').password },
  })
  expect(login.ok()).toBeTruthy()

  stu = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  const a = account(STUDENT)
  await stu.goto('/login')
  await stu.getByLabel('Username').fill(a.username)
  await stu.getByLabel('Password').fill(a.password)
  await stu.getByRole('button', { name: 'Sign in' }).click()
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()

  lab = await createLab(ins, {
    name: CLASS_NAME,
    title: TITLE,
    files: [{ path: 'main.py', content: "print('hi')\n" }],
  })
  other = await createLab(ins, {
    name: OTHER_CLASS,
    title: `Other ${run}`,
    files: [{ path: 'main.py', content: "print('other')\n" }],
  })
  for (const l of [lab, other]) {
    await join(stu.request, l)
    expect(await approveAll(ins, l)).toBe(1)
  }
})

test('the icon strip is fixed: it does not open when hovered', async () => {
  await stu.goto('/my/classes')
  const bar = strip().locator('xpath=..')
  await stu.mouse.move(700, 400)
  expect((await bar.boundingBox())!.width).toBe(48)

  await bar.hover()
  await stu.waitForTimeout(400)
  expect((await bar.boundingBox())!.width).toBe(48)

  // Icons only, so the names are tooltips and screen-reader text.
  await expect(strip().getByRole('link')).toHaveText([
    'My classes',
    'Python Tutorial',
    'My workspace',
  ])
  await expect(strip().getByRole('link', { name: 'My workspace' })).toHaveAttribute(
    'title',
    'My workspace',
  )
  await expect(stu.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('the top bar is on the class list page, and says who is signed in', async () => {
  await stu.goto('/my/classes')
  await expect(topbar()).toBeVisible()
  await expect(topbar().getByRole('navigation', { name: 'Breadcrumb' })).toContainText('My classes')
  await expect(topbar().getByText('Student 15')).toBeVisible()
  await expect(topbar().getByText(`@${STUDENT}`)).toBeVisible()
})

test('the class list on the left opens the chosen class in the page', async () => {
  await stu.goto('/my/classes')
  const items = classList().getByRole('link')
  await expect(items.filter({ hasText: CLASS_NAME })).toBeVisible()
  await expect(items.filter({ hasText: OTHER_CLASS })).toBeVisible()

  await items.filter({ hasText: CLASS_NAME }).click()
  await expect(stu).toHaveURL(new RegExp(`/my/classes/${lab.classId}$`))
  await expect(stu.getByRole('heading', { name: CLASS_NAME, level: 1 })).toBeVisible()
  // The class is marked in the list, and the top bar's path names it.
  await expect(items.filter({ hasText: CLASS_NAME })).toHaveAttribute('aria-current', 'page')
  await expect(items.filter({ hasText: OTHER_CLASS })).not.toHaveAttribute('aria-current', 'page')
  await expect(topbar().getByRole('navigation', { name: 'Breadcrumb' })).toContainText(CLASS_NAME)

  // Another class replaces the content without leaving the frame.
  await items.filter({ hasText: OTHER_CLASS }).click()
  await expect(stu).toHaveURL(new RegExp(`/my/classes/${other.classId}$`))
  await expect(stu.getByRole('heading', { name: OTHER_CLASS, level: 1 })).toBeVisible()
  await expect(topbar()).toBeVisible()
})

test('the + in the class list opens the join dialog', async () => {
  await stu.goto('/my/classes')
  await classList().getByRole('button', { name: 'Join with a code' }).click()
  await expect(stu.getByRole('dialog', { name: 'Join a class' })).toBeVisible()
  await stu.keyboard.press('Escape')
  await expect(stu.getByRole('dialog', { name: 'Join a class' })).toBeHidden()
})

test('the workspace keeps the top bar, with its buttons in it, and brings its own explorer', async () => {
  await stu.goto(`/my/classes/${lab.classId}/workspace?activity=${lab.activityId}`)
  await expect(stu.getByRole('tab', { name: /^main\.py/ })).toHaveAttribute('aria-selected', 'true')

  // The top bar: the path, and the page's own buttons.
  await expect(topbar().getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    `My classes${CLASS_NAME}Workspace`,
  )
  await expect(topbar().getByRole('button', { name: 'Submit', exact: true })).toBeVisible()
  await expect(topbar().getByRole('button', { name: 'Instructions' })).toBeVisible()
  await expect(strip()).toBeVisible()

  // The IDE's explorer is its second side bar: the class list is not repeated beside it.
  await expect(stu.getByRole('complementary', { name: 'Your files' })).toBeVisible()
  await expect(classList()).toHaveCount(0)

  // The breadcrumb leads back.
  await topbar().getByRole('link', { name: CLASS_NAME }).click()
  await expect(stu.getByRole('heading', { name: CLASS_NAME, level: 1 })).toBeVisible()
  await expect(classList()).toBeVisible()
})

test('Practice has the top bar too, and its title is the page heading', async () => {
  await stu.goto('/practice')
  await expect(topbar().getByRole('heading', { name: 'My workspace', level: 1 })).toBeVisible()
  await expect(strip()).toBeVisible()
  await expect(stu.getByRole('complementary', { name: 'Your files' })).toBeVisible()
  // Nothing belongs to a class here, so there is nothing of a class in the bar.
  await expect(topbar().getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0)
})

test('the icon of the page you are on hides and shows its side bar, and the page takes the room', async () => {
  await stu.goto('/my/classes')
  const main = stu.getByRole('main')
  const icon = strip().getByRole('link', { name: 'My classes' })
  await expect(classList()).toBeVisible()
  await expect(icon).toHaveAttribute('aria-expanded', 'true')
  const before = (await main.boundingBox())!

  await icon.click()
  await expect(classList()).toHaveCount(0)
  await expect(icon).toHaveAttribute('aria-expanded', 'false')
  await expect(stu).toHaveURL(/\/my\/classes$/) // it toggled; it did not navigate
  const wider = (await main.boundingBox())!
  expect(wider.x).toBeLessThan(before.x)
  expect(wider.width).toBeGreaterThan(before.width)

  await icon.click()
  await expect(classList()).toBeVisible()

  // Another icon goes to its page with the side bar shown, even if it had been hidden.
  await icon.click()
  await expect(classList()).toHaveCount(0)
  await strip().getByRole('link', { name: 'My workspace' }).click()
  await expect(stu).toHaveURL(/\/practice$/)
  const explorer = stu.getByRole('complementary', { name: 'Your files' })
  await expect(explorer).toBeVisible()

  // In the IDE the same icon hides the explorer, and the resize handle with it.
  await strip().getByRole('link', { name: 'My workspace' }).click()
  await expect(explorer).toHaveCount(0)
  await expect(stu.getByRole('separator', { name: 'Resize the file list' })).toHaveCount(0)
  await strip().getByRole('link', { name: 'My workspace' }).click()
  await expect(explorer).toBeVisible()
})

test('at its narrowest, the explorer still shows all four of its buttons', async () => {
  await stu.goto('/practice')
  const explorer = stu.getByRole('complementary', { name: 'Your files' })
  await expect(explorer).toBeVisible()
  const handle = stu.getByRole('separator', { name: 'Resize the file list' })
  await handle.focus()
  for (let i = 0; i < 40; i++) await stu.keyboard.press('ArrowLeft')
  await expect(handle).toHaveAttribute('aria-valuenow', '180')

  const box = (await explorer.boundingBox())!
  for (const name of ['File', 'Folder', 'Rename or move', 'Delete']) {
    const button = explorer.getByRole('button', { name, exact: true })
    await expect(button).toBeVisible()
    const b = (await button.boundingBox())!
    expect(b.x + b.width, `${name} fits inside the explorer`).toBeLessThanOrEqual(
      box.x + box.width + 0.5,
    )
  }
  // Put the width back for whoever uses this account next.
  for (let i = 0; i < 6; i++) await stu.keyboard.press('ArrowRight')
})
