import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, setUnauthorizedHandler } from './client'
import { ApiError } from './errors'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  setUnauthorizedHandler(null)
  vi.unstubAllGlobals()
})

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status })
}

describe('api client', () => {
  it('always sends the session cookie and builds the query string', async () => {
    fetchMock.mockResolvedValue(reply(200, { items: [] }))
    await api.get('/users', { query: { page: 2, search: '', role: undefined, size: 20 } })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/users?page=2&size=20')
    expect(init?.credentials).toBe('include')
  })

  it('sends JSON bodies with a content type', async () => {
    fetchMock.mockResolvedValue(reply(200, {}))
    await api.post('/auth/login', { body: { username: 'a', password: 'b' } })

    const init = fetchMock.mock.calls[0]![1]!
    expect(init.body).toBe('{"username":"a","password":"b"}')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('returns undefined for 204', async () => {
    fetchMock.mockResolvedValue(reply(204))
    await expect(api.post('/auth/logout')).resolves.toBeUndefined()
  })

  it('throws ApiError and calls the global handler on 401', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    fetchMock.mockResolvedValue(
      reply(401, { detail: 'Signed in on another device', code: 'SESSION_REPLACED' }),
    )

    await expect(api.get('/auth/me')).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_REPLACED',
    })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0]![0]).toBeInstanceOf(ApiError)
  })

  it('does not call the global handler when skipAuthHandler is set (wrong password)', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    fetchMock.mockResolvedValue(
      reply(401, { detail: 'Invalid username or password', code: 'INVALID_CREDENTIALS' }),
    )

    await expect(api.post('/auth/login', { skipAuthHandler: true })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not treat other errors as a lost session', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    fetchMock.mockResolvedValue(
      reply(403, { detail: 'Laboratory access is closed', code: 'LAB_CLOSED' }),
    )

    await expect(api.put('/workspace/files/1')).rejects.toMatchObject({ code: 'LAB_CLOSED' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('turns a network failure into a friendly ApiError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.get('/health')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  })
})
