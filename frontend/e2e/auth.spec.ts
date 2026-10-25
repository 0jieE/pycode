import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'

async function signIn(page: Page, username: string, password?: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password ?? account(username).password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

const HOMES = [
  { username: 'admin', path: '/admin/users/students', heading: 'Students' },
  { username: 'instructor1', path: '/classes', heading: 'Classes' },
  { username: 'student01', path: '/my/classes', heading: 'My classes' },
]

for (const { username, path, heading } of HOMES) {
  test(`${username} signs in, lands on ${path} and signs out`, async ({ page, baseURL }) => {
    const foreign: string[] = []
    const origin = new URL(baseURL!).origin
    page.on('request', (req) => {
      if (new URL(req.url()).origin !== origin) foreign.push(req.url())
    })

    await signIn(page, username)
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()

    // Reload keeps the session (httpOnly cookie + /auth/me bootstrap).
    await page.reload()
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    expect(foreign, 'requests to other hosts').toEqual([])
  })
}

test('wrong password shows an inline error and stays on the login page', async ({ page }) => {
  await signIn(page, 'student01', 'definitely-wrong')
  await expect(page.getByRole('alert')).toContainText('Invalid username or password')
  await expect(page).toHaveURL(/\/login$/)
  // A wrong password is not a lost session: no banner.
  await expect(page.getByText('signed in on another device')).toHaveCount(0)
})

test('empty form is checked before any request is sent', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Enter your username.')).toBeVisible()
  await expect(page.getByText('Enter your password.')).toBeVisible()
})

test('students cannot open admin pages and are sent home', async ({ page }) => {
  await signIn(page, 'student01')
  await expect(page).toHaveURL(/\/my\/classes$/)
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/my\/classes$/)
})

test('signed-out visitors are sent to login', async ({ page }) => {
  await page.goto('/classes')
  await expect(page).toHaveURL(/\/login$/)
})

test('a second login elsewhere kicks the first back to login with the banner', async ({
  browser,
}) => {
  const first = await (await browser.newContext()).newPage()
  const second = await (await browser.newContext()).newPage()

  await signIn(first, 'student02')
  await expect(first.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()

  await signIn(second, 'student02')
  await expect(second.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()

  // The first tab notices on its next request (here: the re-check when it regains focus).
  await first.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(first).toHaveURL(/\/login$/)
  await expect(first.getByText('You were signed in on another device')).toBeVisible()

  // The second one is unaffected.
  await second.reload()
  await expect(second.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
})

test('a tab reloaded after its session was replaced shows the banner and stops asking', async ({
  browser,
}) => {
  const first = await (await browser.newContext()).newPage()
  const second = await (await browser.newContext()).newPage()
  await signIn(first, 'student08')
  await expect(first.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  await signIn(second, 'student08')
  await expect(second.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()

  let meRequests = 0
  first.on('request', (req) => {
    if (req.url().endsWith('/api/v1/auth/me')) meRequests++
  })
  await first.reload()
  await expect(first).toHaveURL(/\/login$/)
  await expect(first.getByText('You were signed in on another device')).toBeVisible()

  // The page must settle: no request loop while it sits on the login page.
  await first.waitForTimeout(3000)
  expect(meRequests).toBeLessThanOrEqual(2)
})
