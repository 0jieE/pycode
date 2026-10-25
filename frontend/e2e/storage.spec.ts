import { expect, test, type Page } from '@playwright/test'
import { account, type Account } from './accounts'
import { approveAll, createLab, type Lab } from './lab'

/**
 * Workspace storage limits: the admin's Storage page (per role) and one user's own limits from Users. Only raised
 * limits are tried, so other specs are never refused, and the defaults are put back at the end. Then the admin
 * clears one class workspace of a student (of a class made here) while the student has a file open.
 */

const ADMIN = account('admin')
const STUDENT = account('student01')
const DEFAULTS = { max_file_bytes: 102400, max_workspace_bytes: 2097152, max_files: 100 }

let page: Page
let studentId = 0
let studentName = ''
let ins: Page | undefined
let lab: Lab | undefined

async function signIn(p: Page, who: Account) {
  await p.goto('/login')
  await p.getByLabel('Username').fill(who.username)
  await p.getByLabel('Password').fill(who.password)
  await p.getByRole('button', { name: 'Sign in' }).click()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await page.goto('/login')
  await page.getByLabel('Username').fill(ADMIN.username)
  await page.getByLabel('Password').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Students', level: 1 })).toBeVisible()
  const found = await page.request.get(`/api/v1/users?q=${STUDENT.username}&size=5`)
  const me = (
    (await found.json()).items as { id: number; username: string; full_name: string }[]
  ).find((u) => u.username === STUDENT.username)!
  studentId = me.id
  studentName = me.full_name
  // Start from the defaults, whatever an earlier run left.
  await page.request.patch('/api/v1/storage-limits/student', { data: DEFAULTS })
  await page.request.put(`/api/v1/users/${studentId}/storage`, { data: {} })
})

test.afterAll(async () => {
  await page.request.patch('/api/v1/storage-limits/student', { data: DEFAULTS })
  await page.request.put(`/api/v1/users/${studentId}/storage`, { data: {} })
  // No running session and no room left behind (a room whose session has not ended cannot be deleted).
  if (ins && lab) {
    await ins.request.patch(`/api/v1/sessions/${lab.sessionId}/close`)
    await ins.request.patch(`/api/v1/sessions/${lab.sessionId}`, {
      data: { ends_at: new Date().toISOString() },
    })
    await ins.request.delete(`/api/v1/labs/${lab.roomId}`)
  }
})

test('1. the admin changes what each student workspace may hold', async () => {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Storage' })
    .click()
  await expect(page.getByRole('heading', { name: 'Storage', level: 1 })).toBeVisible()
  const students = page.getByRole('region', { name: 'Students' })
  await expect(students.getByText('Defaults')).toBeVisible()
  await expect(students.getByLabel('Largest file', { exact: true })).toHaveValue('100')
  await expect(students.getByLabel('Workspace size', { exact: true })).toHaveValue('2')

  // A file larger than the whole workspace is refused before anything is sent.
  await students.getByLabel('Largest file', { exact: true }).fill('3')
  await students.getByLabel('Largest file: unit').selectOption('MB')
  await students.getByRole('button', { name: 'Save students' }).click()
  await expect(students.getByText(/Enter a size from 1 KB to 1 MB/)).toBeVisible()
  await students.getByLabel('Largest file', { exact: true }).fill('1')
  await students.getByLabel('Workspace size', { exact: true }).fill('512')
  await students.getByLabel('Workspace size: unit').selectOption('KB')
  await students.getByRole('button', { name: 'Save students' }).click()
  await expect(
    students.getByText(/can't be larger than the whole workspace \(512 KB\)/),
  ).toBeVisible()
  await students.getByLabel('Workspace size', { exact: true }).fill('2')
  await students.getByLabel('Workspace size: unit').selectOption('MB')

  await students.getByLabel('Largest file', { exact: true }).fill('200')
  await students.getByLabel('Largest file: unit').selectOption('KB')
  await students.getByLabel('Number of files').fill('150')
  await students.getByRole('button', { name: 'Save students' }).click()
  await expect(page.getByText('Storage limits saved for students')).toBeVisible()
  await expect(students.getByText(/^Changed /)).toBeVisible()
  await expect(
    students.getByText('Now: 200 KB per file, 2 MB per workspace, 150 files.'),
  ).toBeVisible()

  // Back to the defaults.
  await students.getByRole('button', { name: 'Use the defaults' }).click()
  await students.getByRole('button', { name: 'Save students' }).click()
  await expect(
    students.getByText('Now: 100 KB per file, 2 MB per workspace, 100 files.'),
  ).toBeVisible()
})

test('2. one student gets their own limits; empty fields follow the role', async () => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Users' }).click()
  await page.getByLabel('Search').fill(STUDENT.username)
  await page.getByRole('button', { name: `Storage of ${studentName}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Storage of ${studentName}` })
  await expect(dialog.getByText(/Applies now: 100 KB per file, 2 MB per workspace/)).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'Their workspaces' })).toBeVisible()

  await dialog.getByLabel('Largest file', { exact: true }).fill('500')
  await dialog.getByRole('button', { name: 'Save limits' }).click()
  await expect(page.getByText(/^Storage limits saved for /)).toBeVisible()

  await page.getByRole('button', { name: `Storage of ${studentName}`, exact: true }).click()
  await expect(dialog.getByLabel('Largest file', { exact: true })).toHaveValue('500')
  await expect(dialog.getByLabel('Workspace size', { exact: true })).toHaveValue('')
  await expect(dialog.getByText(/Applies now: 500 KB per file, 2 MB per workspace/)).toBeVisible()

  await dialog.getByRole('button', { name: /^Use the students' limits/ }).click()
  await dialog.getByRole('button', { name: 'Save limits' }).click()
  await expect(dialog).toBeHidden()
  const back = await page.request.get(`/api/v1/users/${studentId}/storage`)
  expect((await back.json()).override).toEqual({
    max_file_bytes: null,
    max_workspace_bytes: null,
    max_files: null,
  })
})

test('3. the admin clears a class workspace; the student is told their open file is gone', async ({
  browser,
}) => {
  const run = Date.now().toString(36)
  const className = `E2E Clear ${run}`
  const open = async () =>
    (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  ins = await open()
  await signIn(ins, account('instructor2'))
  await expect(ins.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()
  lab = await createLab(ins.request, {
    name: className,
    title: `Clear me ${run}`,
    files: [{ path: 'main.py', content: "print('starter')\n" }],
  })

  const student = account('student22')
  const stu = await open()
  await signIn(stu, student)
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  const joined = await stu.request.post('/api/v1/enroll', { data: { code: lab.code } })
  expect([200, 201], await joined.text()).toContain(joined.status())
  expect(await approveAll(ins.request, lab)).toBe(1)

  // The student has the starter file open.
  await stu.goto(`/my/classes/${lab.classId}/workspace`)
  await stu.getByRole('treeitem', { name: /^main\.py/ }).click()
  await expect(stu.locator('.cm-content')).toContainText("print('starter')")

  // The admin clears that workspace, after confirming.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Users' }).click()
  await page.getByLabel('Search').fill(student.username)
  const me = (
    (await (await page.request.get(`/api/v1/users?q=${student.username}`)).json()).items as {
      username: string
      full_name: string
    }[]
  ).find((u) => u.username === student.username)!
  await page.getByRole('button', { name: `Storage of ${me.full_name}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Storage of ${me.full_name}` })
  await dialog.getByRole('button', { name: `Clear the ${className} workspace` }).click()
  const confirm = page.getByRole('dialog', {
    name: `Clear the ${className} workspace of ${me.full_name}?`,
  })
  await expect(confirm.getByText(/1 file \(.+\) will be deleted/)).toBeVisible()
  await expect(confirm.getByText(/starter files .* will be restored/)).toBeVisible()
  await expect(confirm.getByText('This cannot be undone.')).toBeVisible()
  await confirm.getByRole('button', { name: 'Clear workspace' }).click()
  await expect(
    page.getByText(`${className} workspace cleared: 1 file deleted, 1 starter file restored`),
  ).toBeVisible()

  // The student's open file no longer exists (the starter file came back as a new one): saving says so.
  await stu.locator('.cm-content').click()
  await stu.keyboard.type('# more')
  await expect(stu.getByText('This file no longer exists.')).toBeVisible({ timeout: 15_000 })
  await expect(stu.getByRole('treeitem', { name: /^main\.py/ })).toBeVisible()
  await stu.context().close()
})
