import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'

/**
 * An instructor's My workspace folder becomes a class activity: right-click it, "Attach to activity…", pick the
 * class. Only folders with no folders inside can be attached.
 */

const run = Date.now().toString(36)
const FOLDER = `attach-${run}`
const NESTED = `nested-${run}`

let page: Page
let classId = 0

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  const a = account('instructor2')
  await page.goto('/login')
  await page.getByLabel('Username').fill(a.username)
  await page.getByLabel('Password').fill(a.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()

  const cls = await page.request.post('/api/v1/classes', {
    data: { name: `E2E Attach ${run}`, year_and_section: 'BSIT A-1', school_year: '2026-2027' },
  })
  expect(cls.ok()).toBeTruthy()
  classId = (await cls.json()).id

  const files = [
    { path: `${FOLDER}/main.py`, content: "from helper import greet\nprint(greet('BSIT'))\n" },
    { path: `${FOLDER}/helper.py`, content: "def greet(who):\n    return 'Hello, ' + who\n" },
    { path: `${NESTED}/inner/x.py`, content: 'print(1)\n' },
  ]
  for (const f of files) {
    const made = await page.request.post('/api/v1/practice/files', { data: f })
    expect(made.ok(), await made.text()).toBeTruthy()
  }
})

test('a flat folder becomes a draft activity with its files as starter files', async () => {
  await page.goto('/practice')
  await page.getByRole('treeitem', { name: new RegExp(`^${FOLDER}`) }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Attach to activity…' }).click()

  const dialog = page.getByRole('dialog', { name: 'Attach to an activity' })
  await expect(dialog).toContainText('2 files')
  await dialog.getByLabel('Class').selectOption(String(classId))
  await expect(dialog.getByLabel('Activity')).toHaveValue('new')
  await expect(dialog.getByLabel('File students run (and that tests grade)')).toHaveValue('main.py')
  await dialog.getByRole('button', { name: 'Create activity' }).click()

  await expect(page).toHaveURL(new RegExp(`/classes/${classId}/activities/\\d+$`))
  const id = Number(page.url().split('/').pop())
  const activity = await (await page.request.get(`/api/v1/activities/${id}`)).json()
  expect(activity.title).toBe(FOLDER)
  expect(activity.is_published).toBe(false)
  expect(activity.entry_file).toBe('main.py')
  const byPath = Object.fromEntries(
    (activity.starter_files as { path: string; content: string }[]).map((f) => [f.path, f.content]),
  )
  expect(Object.keys(byPath).sort()).toEqual(['helper.py', 'main.py'])
  expect(byPath['helper.py']).toContain('def greet')
})

test('a folder with folders inside cannot be attached', async () => {
  await page.goto('/practice')
  await page.getByRole('treeitem', { name: new RegExp(`^${NESTED}`) }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: /^Attach to activity/ })).toBeDisabled()
  await page.keyboard.press('Escape')
})
