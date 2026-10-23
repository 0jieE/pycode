import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import { createSaver, type SaverDeps } from './saver'
import { isDirty, useWorkspaceStore } from './workspaceStore'

const s = () => useWorkspaceStore.getState()

/** A fake server: tokens go T1, T2, ... and a save must present the current one, like the real lock. */
function fakeServer(initialToken = 'T0') {
  let token = initialToken
  let n = 0
  const calls: { id: number; content: string; token: string; version: boolean }[] = []
  const request: SaverDeps['request'] = async (id, content, sent, version) => {
    calls.push({ id, content, token: sent, version })
    if (sent !== token) {
      throw new ApiError(409, 'SAVE_CONFLICT', 'This file changed since you opened it.')
    }
    token = `T${++n}`
    return { updated_at: token }
  }
  return { request, calls, setToken: (t: string) => (token = t) }
}

function setup(request: SaverDeps['request']) {
  const onError = vi.fn()
  const onSaved = vi.fn()
  return { saver: createSaver({ request, onError, onSaved }), onError, onSaved }
}

beforeEach(() => {
  s().reset()
  s().load({ id: 1, content: 'a', updated_at: 'T0' })
})

describe('save', () => {
  it('sends the content with the file token and stores the token from the reply', async () => {
    const server = fakeServer()
    const { saver, onSaved } = setup(server.request)
    s().edit(1, 'ab')

    expect(await saver.save(1)).toBe('saved')
    expect(server.calls).toEqual([{ id: 1, content: 'ab', token: 'T0', version: false }])
    expect(s().files[1]).toMatchObject({ savedContent: 'ab', updatedAt: 'T1' })
    expect(isDirty(s().files[1])).toBe(false)
    expect(onSaved).toHaveBeenCalledWith(1)
  })

  it('marks the file as saving while the request is in flight, and clears it after any outcome', async () => {
    let seen: boolean | undefined
    const request: SaverDeps['request'] = async () => {
      seen = s().files[1]!.saving
      throw new ApiError(500, 'HTTP_500', 'The server had a problem.')
    }
    const { saver } = setup(request)
    s().edit(1, 'ab')
    await saver.save(1)
    expect(seen).toBe(true)
    expect(s().files[1]!.saving).toBe(false)
  })

  it('skips an unchanged file, but a manual save still goes through as a version', async () => {
    const server = fakeServer()
    const { saver } = setup(server.request)
    expect(await saver.save(1)).toBe('skipped')
    expect(server.calls).toHaveLength(0)

    expect(await saver.save(1, { version: true })).toBe('saved')
    expect(server.calls).toEqual([{ id: 1, content: 'a', token: 'T0', version: true }])
  })

  it('never sends two saves of one file at once: the second waits and uses the first one’s token', async () => {
    const server = fakeServer()
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const slow: SaverDeps['request'] = async (...args) => {
      if (server.calls.length === 0) await gate
      return server.request(...args)
    }
    const { saver } = setup(slow)

    s().edit(1, 'one')
    const first = saver.save(1)
    await Promise.resolve()
    s().edit(1, 'one two') // typed while the first request is still in flight
    const second = saver.save(1)
    release()

    expect(await first).toBe('saved')
    expect(await second).toBe('saved')
    expect(server.calls.map((c) => [c.content, c.token])).toEqual([
      ['one', 'T0'],
      ['one two', 'T1'],
    ])
    expect(isDirty(s().files[1])).toBe(false)
  })

  it('does not touch a file with an unresolved conflict', async () => {
    const server = fakeServer()
    const { saver } = setup(server.request)
    s().edit(1, 'ab')
    s().setConflict(1, true)
    expect(await saver.save(1)).toBe('skipped')
    expect(server.calls).toHaveLength(0)
  })
})

describe('failures', () => {
  it('flags a 409 as a conflict and keeps the text', async () => {
    const server = fakeServer()
    server.setToken('SOMEONE-ELSE')
    const { saver, onError } = setup(server.request)
    s().edit(1, 'mine')

    expect(await saver.save(1)).toBe('conflict')
    expect(s().files[1]).toMatchObject({ conflict: true, content: 'mine' })
    expect(onError).not.toHaveBeenCalled() // the dialog explains it, not a toast
  })

  it('locks the workspace on LAB_CLOSED and keeps the unsaved text in memory', async () => {
    const request: SaverDeps['request'] = async () => {
      throw new ApiError(403, 'LAB_CLOSED', 'Laboratory access is closed')
    }
    const { saver, onError } = setup(request)
    s().edit(1, 'precious work')

    expect(await saver.save(1)).toBe('locked')
    expect(s().locked).toBe(true)
    expect(s().unsavedNotice).toBe(true)
    expect(s().files[1]!.content).toBe('precious work')
    expect(isDirty(s().files[1])).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })

  it('on ACTIVITY_ARCHIVED marks the file, goes back to the saved text, and says so once', async () => {
    const message = "'Lab 1' was archived by your instructor: its folder is read-only"
    const request: SaverDeps['request'] = async () => {
      throw new ApiError(403, 'ACTIVITY_ARCHIVED', message)
    }
    const { saver, onError } = setup(request)
    s().load({ id: 2, content: 'b', updated_at: 'T0' })
    s().edit(1, 'typed')
    s().edit(2, 'typed too')

    // 'skipped', not an error: a Run (which saves first) must still go ahead.
    expect(await saver.saveAll()).toBe('saved')
    expect(s().archived).toEqual({ 1: message, 2: message })
    expect(s().files[1]!.content).toBe('a')
    expect(isDirty(s().files[1])).toBe(false)
    expect(s().locked).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(message)
  })

  it('reports other server errors (too large, quota) with the server’s words', async () => {
    const request: SaverDeps['request'] = async () => {
      throw new ApiError(413, 'FILE_TOO_LARGE', 'File is larger than 100 KB')
    }
    const { saver, onError } = setup(request)
    s().edit(1, 'x')
    expect(await saver.save(1)).toBe('error')
    expect(onError).toHaveBeenCalledWith('File is larger than 100 KB')
  })

  it('stays quiet about a 401: the app is already signing the user out', async () => {
    const request: SaverDeps['request'] = async () => {
      throw new ApiError(401, 'SESSION_REPLACED', 'Signed in on another device')
    }
    const { saver, onError } = setup(request)
    s().edit(1, 'x')
    expect(await saver.save(1)).toBe('error')
    expect(onError).not.toHaveBeenCalled()
  })

  it('gives a friendly message for unexpected errors', async () => {
    const request: SaverDeps['request'] = async () => {
      throw new TypeError('boom')
    }
    const { saver, onError } = setup(request)
    s().edit(1, 'x')
    await saver.save(1)
    expect(onError).toHaveBeenCalledWith('Your changes could not be saved. Please try again.')
  })
})

describe('saveAll', () => {
  it('saves every dirty file and reports saved', async () => {
    const server = fakeServer()
    s().load({ id: 2, content: 'b', updated_at: 'T0' })
    const { saver } = setup(server.request)
    s().edit(1, 'a1')
    s().edit(2, 'b1')

    // Both files share the fake server's single token, so save them one after the other.
    expect(await saver.save(1)).toBe('saved')
    server.setToken('T0')
    expect(await saver.saveAll()).toBe('saved')
    expect(server.calls.map((c) => c.id)).toEqual([1, 2])
  })

  it('a file deleted on the server closes, the tree is reloaded, and the student is told', async () => {
    const request: SaverDeps['request'] = async () => {
      throw new ApiError(404, 'FILE_NOT_FOUND', 'File not found')
    }
    const onError = vi.fn()
    const onMissing = vi.fn()
    const saver = createSaver({ request, onError, onMissing })
    s().edit(1, 'x')
    expect(await saver.save(1)).toBe('error')
    expect(s().files[1]).toBeUndefined()
    expect(s().tabs).not.toContain(1)
    expect(onMissing).toHaveBeenCalledWith(1)
    expect(onError).toHaveBeenCalledWith('This file no longer exists.')
  })

  it('reports the failure so a run or submit can stop', async () => {
    const request: SaverDeps['request'] = async () => {
      throw new ApiError(403, 'LAB_CLOSED', 'closed')
    }
    const { saver } = setup(request)
    s().edit(1, 'x')
    expect(await saver.saveAll()).toBe('locked')
  })

  it('is a no-op when nothing is dirty', async () => {
    const server = fakeServer()
    const { saver } = setup(server.request)
    expect(await saver.saveAll()).toBe('saved')
    expect(server.calls).toHaveLength(0)
  })
})
