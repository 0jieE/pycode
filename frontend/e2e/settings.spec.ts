import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'

/**
 * Settings (the gear by the account badge): the theme of the app and of the code editor. Saved to the account,
 * so it follows the user to another browser.
 */

const STUDENT = 'student12'

let page: Page

const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
const canvas = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

async function signIn(p: Page, username: string) {
  const a = account(username)
  await p.goto('/login')
  await p.getByLabel('Username').fill(a.username)
  await p.getByLabel('Password').fill(a.password)
  await p.getByRole('button', { name: 'Sign in' }).click()
}

async function openSettings(p: Page) {
  await p.getByRole('button', { name: 'Settings' }).click()
  return p.getByRole('dialog', { name: 'Settings' })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await signIn(page, STUDENT)
  await expect(page.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  // Start from the defaults, whatever an earlier run left.
  const reset = await page.request.patch('/api/v1/auth/me/preferences', {
    data: { theme: 'dark', editor_theme: 'match' },
  })
  expect(reset.ok()).toBeTruthy()
  await page.reload()
})

test.afterAll(async () => {
  await page.request.patch('/api/v1/auth/me/preferences', {
    data: { theme: 'dark', editor_theme: 'match' },
  })
})

test('the gear opens Settings, and the theme changes at once', async () => {
  expect(await theme()).toBe('dark')
  expect(await canvas()).toBe('rgb(14, 17, 23)') // --color-canvas, dark

  const settings = await openSettings(page)
  await expect(settings.getByRole('radio', { name: 'Dark' }).first()).toBeChecked()
  await settings.getByRole('radio', { name: 'Light' }).first().click()
  await expect.poll(theme).toBe('light')
  expect(await canvas()).toBe('rgb(244, 246, 251)') // --color-canvas, light
  await settings.getByRole('button', { name: 'Done' }).click()
})

test('it is saved to the account: it survives a reload and follows the user to another browser', async ({
  browser,
}) => {
  await page.reload()
  await expect(page.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  expect(await theme()).toBe('light')

  const other = await (await browser.newContext()).newPage()
  await signIn(other, STUDENT)
  await expect(other.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  await expect
    .poll(() => other.evaluate(() => document.documentElement.dataset.theme))
    .toBe('light')
  await other.close()
  // That sign-in replaced this browser's session: sign in again here.
  await signIn(page, STUDENT)
  await expect(page.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
})

test('the code editor follows the theme, unless it is set on its own', async () => {
  await page.goto('/practice')
  const editorBg = () =>
    page.evaluate(() => {
      const el = document.querySelector('.cm-editor')
      return el ? getComputedStyle(el).backgroundColor : null
    })
  // A file to show in the editor.
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New file' })
  await dialog.getByLabel('File name').fill(`theme_${Date.now().toString(36)}.py`)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect.poll(editorBg).toBe('rgb(255, 255, 255)') // light, like the app

  const settings = await openSettings(page)
  const group = settings.getByRole('radiogroup', { name: 'Code editor colours' })
  await group.getByRole('radio', { name: 'Dark' }).click()
  await expect.poll(editorBg).toBe('rgb(30, 30, 30)') // dark editor in a light app
  expect(await theme()).toBe('light')

  await group.getByRole('radio', { name: 'Match theme' }).click()
  await expect.poll(editorBg).toBe('rgb(255, 255, 255)')
  await settings.getByRole('button', { name: 'Done' }).click()
})

test('administrators have the gear too', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage()
  await signIn(admin, 'admin')
  await expect(admin.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible()
  const settings = await openSettings(admin)
  await expect(settings.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
  await admin.close()
})
