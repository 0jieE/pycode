import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { account } from './accounts'
import { approveAll, createLab, join, type Lab } from './lab'

/**
 * Search boxes and filters on the instructor's tables: students, activities, submissions, classes.
 * The classroom is built through the API; the searching is done in the UI.
 */

const run = Date.now().toString(36)
const CLASS_NAME = `Search Class ${run}`
const TITLE = `Searchable ${run}`
const DRAFT = `Draft ${run}`
const STUDENTS = ['student01', 'student02', 'student03', 'student04']

let ins: Page
let lab: Lab
const students: APIRequestContext[] = []

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  ins = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
  const a = account('instructor2')
  await ins.goto('/login')
  await ins.getByLabel('Username').fill(a.username)
  await ins.getByLabel('Password').fill(a.password)
  await ins.getByRole('button', { name: 'Sign in' }).click()
  await expect(ins.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible()

  lab = await createLab(ins.request, {
    name: CLASS_NAME,
    title: TITLE,
    files: [{ path: 'main.py', content: "print('hi')\n" }],
  })
  // A draft next to the published activity, for the Status filter.
  const draft = await ins.request.post(`/api/v1/classes/${lab.classId}/activities`, {
    data: { title: DRAFT, instructions: 'Not published', starter_files: [] },
  })
  expect(draft.ok()).toBeTruthy()

  for (const username of STUDENTS) {
    const ctx = await playwright.request.newContext({ baseURL })
    const login = await ctx.post('/api/v1/auth/login', {
      data: { username, password: account(username).password },
    })
    expect(login.ok()).toBeTruthy()
    await join(ctx, lab)
    students.push(ctx)
  }
  expect(await approveAll(ins.request, lab)).toBe(STUDENTS.length)
})

test('students: search by name and by number, count, clear, and no match', async () => {
  await ins.goto(`/classes/${lab.classId}?tab=students`)
  const table = ins.getByRole('table', { name: 'Approved students' })
  await expect(table.getByRole('row')).toHaveCount(STUDENTS.length + 1) // + the header

  const toolbar = ins.getByRole('search', { name: 'Search and filter students' })
  await expect(toolbar).toContainText('4 students')

  await toolbar.getByLabel('Search students').fill('student02')
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table).toContainText('Student 02')
  await expect(toolbar).toContainText('1 of 4 students')

  // The student number works too (the test backend numbers them E2E-01 ...).
  await toolbar.getByLabel('Search students').fill('E2E-03')
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table).toContainText('Student 03')

  await toolbar.getByRole('button', { name: 'Clear' }).click()
  await expect(table.getByRole('row')).toHaveCount(STUDENTS.length + 1)
  await expect(toolbar.getByLabel('Search students')).toHaveValue('')

  await toolbar.getByLabel('Search students').fill('nobody by this name')
  await expect(ins.getByText('No students match')).toBeVisible()
  await ins.getByRole('button', { name: 'Clear search and filters' }).click()
  await expect(table.getByRole('row')).toHaveCount(STUDENTS.length + 1)
})

test('activities: search by title and filter by status', async () => {
  await ins.goto(`/classes/${lab.classId}?tab=activities`)
  const table = ins.getByRole('table', { name: 'Activities' })
  await expect(table.getByRole('row')).toHaveCount(3) // header + published + draft

  const toolbar = ins.getByRole('search', { name: 'Search and filter activities' })
  await toolbar.getByLabel('Status').selectOption('draft')
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table).toContainText(DRAFT)
  await expect(table).not.toContainText(TITLE)
  await expect(toolbar).toContainText('1 of 2 activities')

  // Filter and search together: a published title does not match the draft filter.
  await toolbar.getByLabel('Search activities').fill('Searchable')
  await expect(ins.getByText('No activities match')).toBeVisible()
  await ins.getByRole('button', { name: 'Clear search and filters' }).click()

  await toolbar.getByLabel('Status').selectOption('published')
  await expect(table).toContainText(TITLE)
  await expect(table).not.toContainText(DRAFT)

  // Not due yet / past due / no due date: neither activity has a due date.
  await toolbar.getByLabel('Status').selectOption('')
  await toolbar.getByLabel('Due date').selectOption('none')
  await expect(table.getByRole('row')).toHaveCount(3)
  await toolbar.getByLabel('Due date').selectOption('past')
  await expect(ins.getByText('No activities match')).toBeVisible()
})

test('submissions: search narrows both lists, and filters by score', async () => {
  // Two of the students hand in the published activity.
  for (const ctx of students.slice(0, 2)) {
    const res = await ctx.post(`/api/v1/activities/${lab.activityId}/submit`)
    expect(res.ok()).toBeTruthy()
  }
  await ins.goto(`/classes/${lab.classId}/activities/${lab.activityId}/submissions`)
  const table = ins.getByRole('table', { name: 'Submitted work' })
  await expect(table.getByRole('row')).toHaveCount(3)

  const toolbar = ins.getByRole('search', { name: 'Search and filter submissions' })
  await toolbar.getByLabel('Search submissions').fill('student01')
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table).toContainText('Student 01')

  // The search box also narrows the students who have not submitted yet.
  await expect(ins.getByText('No one who has not submitted matches the search.')).toBeVisible()
  await toolbar.getByRole('button', { name: 'Clear' }).click()
  await expect(ins.getByRole('list').getByText('Student 03')).toBeVisible()

  // No Result filter any more (late submissions are not accepted); scores filter instead.
  await expect(toolbar.getByLabel('Result')).toHaveCount(0)
  await toolbar.getByLabel('Score').selectOption('full')
  await expect(ins.getByText('No submissions match')).toBeVisible()
  await toolbar.getByLabel('Score').selectOption('')
  await expect(table.getByRole('row')).toHaveCount(3)
})

test('classes: the class list on the left searches by name, year and section, or school year', async () => {
  await ins.goto('/classes')
  const list = ins.getByRole('complementary', { name: 'Your classes' })
  await list.getByLabel('Search classes').fill(CLASS_NAME)
  await expect(list.getByRole('link')).toHaveCount(1)
  await expect(list.getByRole('link')).toContainText(CLASS_NAME)

  await list.getByLabel('Search classes').fill('zzzz-no-such-class')
  await expect(list.getByText('No class matches your search.')).toBeVisible()
  await list.getByRole('button', { name: 'Clear search' }).click()
  await expect(list.getByRole('link', { name: new RegExp(CLASS_NAME) })).toBeVisible()
})
