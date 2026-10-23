import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { account } from './accounts'
import { approveAll, createLab, join, type Lab } from './lab'

/**
 * The Practice workspace: the same IDE as a class workspace, on the student's own files. It is never
 * locked by a lab session, has nothing to submit, and is invisible to instructors.
 * The class used here has its lab CLOSED, which is exactly when a student wants somewhere to keep coding.
 */

const run = Date.now().toString(36)
const STUDENT = 'student15'
const TITLE = `Practice ${run}`

let ins: APIRequestContext
let stu: Page
let lab: Lab
let studentId = 0

const editor = (p: Page = stu) => p.locator('.cm-content')
const runButton = (p: Page = stu) => p.getByRole('button', { name: 'Run', exact: true })

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  ins = await playwright.request.newContext({ baseURL })
  await ins.post('/api/v1/auth/login', {
    data: { username: 'instructor1', password: account('instructor1').password },
  })
  lab = await createLab(ins, {
    name: `E2E Practice ${run}`,
    title: TITLE,
    files: [{ path: 'main.py', content: "print('class file')\n" }],
  })

  stu = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  await stu.goto('/login')
  await stu.getByLabel('Username').fill(STUDENT)
  await stu.getByLabel('Password').fill(account(STUDENT).password)
  await stu.getByRole('button', { name: 'Sign in' }).click()
  await expect(stu.getByRole('heading', { name: 'My classes', level: 1 })).toBeVisible()
  studentId = (await (await stu.request.get('/api/v1/auth/me')).json()).id

  // A student has ONE practice workspace for good, so earlier runs of this spec left files in it:
  // start from an empty one (deleting a top-level entry deletes everything inside it).
  const before = await (await stu.request.get('/api/v1/practice/tree')).json()
  for (const e of before.entries as { id: number; path: string }[]) {
    if (!e.path.includes('/')) {
      expect((await stu.request.delete(`/api/v1/practice/files/${e.id}`)).ok()).toBeTruthy()
    }
  }
  await join(stu.request, lab)
  await approveAll(ins, lab)

  // The class lab is closed from now on.
  expect((await ins.patch(`/api/v1/sessions/${lab.sessionId}/close`)).ok()).toBeTruthy()
})

test.afterAll(async () => {
  await ins.dispose()
})

test('1. the student sidebar has a Practice entry that opens the IDE in practice mode', async () => {
  await stu.goto('/my/classes')
  const sockets: string[] = []
  stu.on('websocket', (ws) => sockets.push(ws.url()))

  await stu
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My workspace' })
    .click()
  await expect(stu).toHaveURL(/\/practice$/)
  await expect(stu.getByRole('heading', { name: 'My workspace', level: 1 })).toBeVisible()
  // The pointer is still on the side bar, which stays open under it: move off, as a person would.
  await stu.mouse.move(700, 400)

  // The run panel says so, and there is nothing that belongs to a class.
  await expect(
    stu.getByRole('banner').getByRole('heading', { name: 'My workspace', level: 1 }),
  ).toBeVisible()
  await expect(stu.getByRole('button', { name: /^Submit/ })).toHaveCount(0)
  await expect(stu.getByRole('button', { name: 'Instructions' })).toHaveCount(0)
  await expect(stu.getByText(/Laboratory/)).toHaveCount(0)
  await expect(stu.getByText(/read-only/i)).toHaveCount(0)
  await expect(stu.getByRole('button', { name: 'File', exact: true })).toBeEnabled()
  await expect(stu.getByRole('progressbar', { name: 'Workspace storage used' })).toBeVisible()
  await expect(stu.getByText('Your workspace is empty. Create a file to start.')).toBeVisible()

  // Practice has no class, so it opens no class connection (and the student is not "online" to anyone).
  expect(sockets.filter((u) => u.includes('/ws/class/'))).toEqual([])
})

test('2. it works like the class IDE: create, type, autosave, version, history, run', async () => {
  await stu.getByRole('button', { name: 'File', exact: true }).click()
  const dialog = stu.getByRole('dialog', { name: 'New file' })
  await dialog.getByLabel('File name').fill('hello.py')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(stu.getByRole('tab', { name: /^hello\.py/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  await editor().click()
  await stu.keyboard.type("name = input()\nprint('practice ' + name)")
  await expect(stu.getByText('All changes saved')).toBeVisible({ timeout: 10_000 }) // autosave

  const tree = await (await stu.request.get('/api/v1/practice/tree')).json()
  const hello = tree.entries.find((e: { path: string }) => e.path === 'hello.py')
  expect(hello, 'hello.py is in the practice workspace on the server').toBeTruthy()
  const saved = await (await stu.request.get(`/api/v1/practice/files/${hello.id}`)).json()
  expect(saved.content).toContain("print('practice ' + name)")

  await stu.keyboard.press('Control+s')
  await expect(stu.getByText('Saved (version created)')).toBeVisible()
  await stu.getByRole('button', { name: 'History' }).click()
  const drawer = stu.getByRole('dialog', { name: /History: / })
  await expect(drawer.getByRole('listitem')).toHaveCount(1)
  await expect(drawer.locator('.cm-content')).toContainText('practice')
  await stu.keyboard.press('Escape')

  await stu.getByRole('radio', { name: 'Use input list' }).click()
  await stu.getByLabel('Program input (one value per line, read by input())').fill('Mia')
  await runButton().click()
  await expect(stu.getByRole('log', { name: 'Program output' })).toContainText('practice Mia', {
    timeout: 25_000,
  })
  await expect(stu.getByText(/Finished in \d+ ms \(exit 0\)/)).toBeVisible()
})

test('3. folders can be renamed and deleted, keeping open tabs on the new path', async () => {
  await stu.getByRole('button', { name: 'File', exact: true }).click()
  const dialog = stu.getByRole('dialog', { name: 'New file' })
  await dialog.getByLabel('File name').fill('drills/a.py')
  await dialog.getByRole('button', { name: 'Create' }).click()
  const tab = stu.getByRole('tab', { name: /^a\.py/ })
  await expect(tab).toHaveAttribute('title', 'drills/a.py')

  await stu.getByRole('treeitem', { name: /^drills/ }).click({ button: 'right' })
  await stu.getByRole('menuitem', { name: 'Rename / move' }).click()
  const rename = stu.getByRole('dialog', { name: 'Rename or move' })
  await rename.getByLabel('New path').fill('moved')
  await rename.getByRole('button', { name: 'Rename' }).click()
  await expect(stu.getByRole('treeitem', { name: /^moved/ })).toBeVisible()
  await expect(tab).toHaveAttribute('title', 'moved/a.py')

  await stu.getByRole('treeitem', { name: /^moved/ }).click({ button: 'right' })
  await stu.getByRole('menuitem', { name: 'Delete' }).click()
  await stu
    .getByRole('dialog', { name: 'Delete this folder?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(stu.getByRole('treeitem', { name: /^moved/ })).toHaveCount(0)
  await expect(tab).toHaveCount(0)
})

test('4. practice files are private: not in the class workspace, not visible to the instructor', async () => {
  const classTree = await (await stu.request.get(`/api/v1/workspace/${lab.classId}/tree`)).json()
  const classPaths: string[] = classTree.entries.map((e: { path: string }) => e.path)
  expect(classPaths).toContain(`${TITLE}/main.py`)
  expect(classPaths).not.toContain('hello.py')

  const seen = await ins.get(`/api/v1/classes/${lab.classId}/students/${studentId}/workspace`)
  expect(seen.ok()).toBeTruthy()
  const instructorPaths: string[] = (await seen.json()).entries.map((e: { path: string }) => e.path)
  expect(instructorPaths).not.toContain('hello.py')
})

test('5. the read-only class workspace links to Practice, which stays editable and runnable', async () => {
  await stu.goto(`/my/classes/${lab.classId}/workspace?activity=${lab.activityId}`)
  await expect(
    stu.getByText('Laboratory access is closed: your workspace is read-only.'),
  ).toBeVisible()
  await expect(stu.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  await expect(
    stu.getByRole('banner').getByRole('heading', { name: 'My workspace', level: 1 }),
  ).toHaveCount(0) // that label belongs to Practice only

  const banner = stu.getByRole('status').filter({ hasText: 'read-only' })
  await expect(banner).toContainText('Want to keep coding? Open My workspace.')
  const link = banner.getByRole('link', { name: 'Open My workspace' })
  await expect(link).toHaveAttribute('href', '/practice')
  await expect(link).toHaveAttribute('target', '_blank')

  // It opens in a new tab, so the class tab (and anything unsaved in it) is left as it was.
  const [practice] = await Promise.all([stu.context().waitForEvent('page'), link.click()])
  await expect(practice).toHaveURL(/\/practice$/)
  await expect(
    practice.getByRole('banner').getByRole('heading', { name: 'My workspace', level: 1 }),
  ).toBeVisible()
  await expect(stu).toHaveURL(/\/workspace/) // the class tab did not move

  // Practice works although the class lab is closed: open the file, edit, autosave, run.
  await practice.getByRole('treeitem', { name: /^hello\.py/ }).click()
  await expect(editor(practice)).toHaveAttribute('contenteditable', 'true')
  await editor(practice).click()
  await practice.keyboard.press('Control+End')
  await practice.keyboard.type("\nprint('still coding')")
  await expect(practice.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  await practice.getByRole('radio', { name: 'Use input list' }).click()
  await practice.getByLabel('Program input (one value per line, read by input())').fill('Zed')
  await runButton(practice).click()
  await expect(practice.getByRole('log', { name: 'Program output' })).toContainText(
    'still coding',
    {
      timeout: 25_000,
    },
  )
  await expect(practice.getByText(/Laboratory/)).toHaveCount(0)
})

test('6. the class workspace itself is unchanged: still no Practice label, no way to type', async () => {
  await expect(
    stu.getByRole('banner').getByRole('heading', { name: 'My workspace', level: 1 }),
  ).toHaveCount(0)
  await expect(editor()).toHaveAttribute('contenteditable', 'false')
})

test('7. Practice is easy to find: a button on My classes, as well as the sidebar', async () => {
  await stu.goto('/my/classes')
  const main = stu.getByRole('main')
  await expect(
    main.getByText(/My workspace is your own space to write and run Python/),
  ).toBeVisible()
  await main.getByRole('link', { name: 'My workspace', exact: true }).click()
  await expect(stu).toHaveURL(/\/practice$/)
  await expect(
    stu.getByRole('banner').getByRole('heading', { name: 'My workspace', level: 1 }),
  ).toBeVisible()

  // Only students have it: it is the student's own space.
  await stu.goto('/my/classes')
  await expect(stu.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText([
    'My classes',
    'Python Tutorial',
    'My workspace',
  ])
})
