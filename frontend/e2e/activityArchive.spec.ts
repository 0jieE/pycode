import { expect, test, type Page } from '@playwright/test'
import { account } from './accounts'
import { approveAll, createLab, type Lab } from './lab'

/**
 * Removing activities: a draft is deleted; a published one is archived, which hides it from students and makes
 * its folder read-only (it still runs), and unarchiving brings it back.
 */

const run = Date.now().toString(36)
const TITLE = `Archive ${run}`
const STUDENT = 'student20'

let ins: Page
let stu: Page
let lab: Lab

async function signIn(page: Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(account(username).password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

const row = (title: string) => ins.getByRole('row', { name: new RegExp(title) })
const studentTitles = async () =>
  (
    (await (await stu.request.get(`/api/v1/classes/${lab.classId}/activities?size=100`)).json())
      .items as { title: string }[]
  ).map((a) => a.title)

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  ins = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await signIn(ins, 'instructor2')
  await expect(ins.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()
  lab = await createLab(ins.request, {
    name: `E2E Archive ${run}`,
    title: TITLE,
    files: [{ path: 'main.py', content: "print('still runs')\n" }],
  })

  stu = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await signIn(stu, STUDENT)
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  const joined = await stu.request.post('/api/v1/enroll', { data: { code: lab.code } })
  expect([200, 201], await joined.text()).toContain(joined.status())
  expect(await approveAll(ins.request, lab)).toBe(1)
})

test('1. a draft can be deleted', async () => {
  const draft = `Draft ${run}`
  const made = await ins.request.post(`/api/v1/classes/${lab.classId}/activities`, {
    data: { title: draft, starter_files: [{ path: 'main.py', content: '' }] },
  })
  expect(made.ok()).toBeTruthy()

  await ins.goto(`/classes/${lab.classId}?tab=activities`)
  // A published activity has no Delete, only Archive.
  await expect(row(TITLE).getByRole('button', { name: `Delete ${TITLE}` })).toHaveCount(0)
  await row(draft)
    .getByRole('button', { name: `Delete ${draft}` })
    .click()
  await ins
    .getByRole('dialog', { name: 'Delete this draft?' })
    .getByRole('button', { name: 'Delete draft' })
    .click()
  await expect(ins.getByText(`"${draft}" was deleted`)).toBeVisible()
  await expect(row(draft)).toHaveCount(0)
})

test('2. archiving hides it from students; its folder becomes read-only but still runs', async () => {
  await stu.goto(`/my/classes/${lab.classId}/workspace`)
  await stu.getByRole('treeitem', { name: /^main\.py/ }).click()
  const editor = stu.locator('.cm-content')
  await expect(editor).toHaveAttribute('contenteditable', 'true')

  await row(TITLE)
    .getByRole('button', { name: `Archive ${TITLE}` })
    .click()
  await ins
    .getByRole('dialog', { name: 'Archive this activity?' })
    .getByRole('button', { name: 'Archive' })
    .click()
  await expect(ins.getByText(`"${TITLE}" was archived`)).toBeVisible()
  await expect(row(TITLE)).toHaveCount(0)
  await ins.getByRole('button', { name: 'Show archived activities' }).click()
  await expect(row(TITLE).getByText('Archived')).toBeVisible()

  expect(await studentTitles()).not.toContain(TITLE)

  // The student types in the open file: the save is refused, the text goes back, the file turns read-only.
  await editor.click()
  await stu.keyboard.press('Control+End')
  await stu.keyboard.type('\n# typed after archiving')
  await expect(
    stu.getByRole('status').filter({ hasText: 'was archived by your instructor' }),
  ).toBeVisible({
    timeout: 10_000,
  })
  await expect(editor).toHaveAttribute('contenteditable', 'false')
  await expect(editor).not.toContainText('# typed after archiving')

  await stu.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(stu.getByRole('log', { name: 'Program output' })).toContainText('still runs', {
    timeout: 30_000,
  })
})

test('3. unarchiving brings it back for students', async () => {
  await row(TITLE)
    .getByRole('button', { name: `Unarchive ${TITLE}` })
    .click()
  await expect(ins.getByText(`"${TITLE}" is back for students`)).toBeVisible()
  await expect(row(TITLE).getByText('Published')).toBeVisible()
  expect(await studentTitles()).toContain(TITLE)
})
