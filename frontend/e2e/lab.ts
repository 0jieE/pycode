import { expect, type APIRequestContext } from '@playwright/test'

/**
 * Builds a classroom through the API: class, invite code, an OPEN lab session and a published
 * activity. `ins` is any API context signed in as an instructor (the instructor's browser page also
 * works: `page.request` shares its cookie, which matters because an account can only be signed in
 * in one place at a time).
 */
export interface Lab {
  classId: number
  sessionId: number
  /** The room (lab) the session is in: one per classroom, so tests never book the same room at once. */
  roomId: number
  activityId: number
  code: string
  title: string
}

export interface LabFile {
  path: string
  content: string
}

/**
 * A room (lab) of its own. Every session needs one, and the server refuses two sessions in the same room at
 * overlapping times, so tests that run one after another must not share rooms.
 */
export async function createRoom(ins: APIRequestContext, name: string): Promise<number> {
  const room = await ins.post('/api/v1/labs', { data: { name } })
  expect(room.ok(), await room.text()).toBeTruthy()
  return (await room.json()).id as number
}

let roomCount = 0
/** A room name nobody else has (lab names are unique). */
export const roomName = (what: string) => `E2E ${what} ${Date.now().toString(36)}-${++roomCount}`

export async function createLab(
  ins: APIRequestContext,
  opts: { name: string; title: string; files: LabFile[] },
): Promise<Lab> {
  const cls = await ins.post('/api/v1/classes', {
    data: { name: opts.name, year_and_section: 'BSIT E2E', school_year: '2026-2027' },
  })
  expect(cls.ok()).toBeTruthy()
  const classId = (await cls.json()).id as number

  const code = await ins.post(`/api/v1/classes/${classId}/invite-codes`, {
    data: {
      // A minute back: the server stores whole seconds, so "now" could still lie ahead of it.
      valid_from: new Date(Date.now() - 60_000).toISOString(),
      valid_until: new Date(Date.now() + 7 * 864e5).toISOString(),
    },
  })
  expect(code.ok()).toBeTruthy()

  const roomId = await createRoom(ins, roomName('Room'))
  const session = await ins.post(`/api/v1/classes/${classId}/sessions`, {
    data: {
      name: 'Batch 1',
      lab_id: roomId,
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 40 * 60_000).toISOString(),
    },
  })
  const sessionId = (await session.json()).id as number
  expect((await ins.patch(`/api/v1/sessions/${sessionId}/open`)).ok()).toBeTruthy()

  const activity = await ins.post(`/api/v1/classes/${classId}/activities`, {
    data: { title: opts.title, instructions: 'E2E activity', starter_files: opts.files },
  })
  expect(activity.ok()).toBeTruthy()
  const activityId = (await activity.json()).id as number
  expect((await ins.post(`/api/v1/activities/${activityId}/publish`)).ok()).toBeTruthy()

  return {
    classId,
    sessionId,
    roomId,
    activityId,
    code: (await code.json()).code,
    title: opts.title,
  }
}

/**
 * "2026-10-14T09:10": a time `minutes` from now as the session form's Starts field wants it (Manila time). A session
 * whose start has come opens by itself; one a few minutes ahead stays closed until the test presses Open.
 */
export function manilaInput(minutes: number): string {
  return new Date(Date.now() + 8 * 3600_000 + minutes * 60_000).toISOString().slice(0, 16)
}

/** The signed-in student asks to join with the code. */
export async function join(student: APIRequestContext, lab: Lab): Promise<void> {
  const res = await student.post('/api/v1/enroll', { data: { code: lab.code } })
  expect([200, 201]).toContain(res.status())
}

/** The instructor approves everyone who is waiting. */
export async function approveAll(ins: APIRequestContext, lab: Lab): Promise<number> {
  const pending = await ins.get(
    `/api/v1/classes/${lab.classId}/enrollments?status=pending&size=100`,
  )
  const items = (await pending.json()).items as { id: number }[]
  for (const e of items) {
    const res = await ins.patch(`/api/v1/enrollments/${e.id}`, { data: { action: 'approve' } })
    expect(res.ok()).toBeTruthy()
  }
  return items.length
}
