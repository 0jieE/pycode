import { describe, expect, it } from 'vitest'
import { ApiError, errorMessage, parseApiError } from './errors'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('parseApiError', () => {
  it('reads {detail, code} from the backend', async () => {
    const err = await parseApiError(
      jsonResponse(401, { detail: 'Signed in on another device', code: 'SESSION_REPLACED' }),
    )
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(401)
    expect(err.code).toBe('SESSION_REPLACED')
    expect(err.detail).toBe('Signed in on another device')
  })

  it('joins FastAPI-style validation lists', async () => {
    const err = await parseApiError(
      jsonResponse(422, { detail: [{ msg: 'Field required' }, { msg: 'Too short' }] }),
    )
    expect(err.detail).toBe('Field required; Too short')
    expect(err.code).toBe('HTTP_422')
  })

  it('falls back when the body is not JSON (e.g. an Nginx page)', async () => {
    const err = await parseApiError(new Response('<html>502</html>', { status: 502 }))
    expect(err.code).toBe('HTTP_502')
    expect(err.detail).toMatch(/server had a problem/i)
  })

  it('gives rate limiting a friendly message', async () => {
    const err = await parseApiError(new Response('', { status: 429 }))
    expect(err.detail).toMatch(/too many requests/i)
  })
})

describe('errorMessage', () => {
  it('uses the detail of an ApiError', () => {
    expect(errorMessage(new ApiError(403, 'LAB_CLOSED', 'Laboratory access is closed'))).toBe(
      'Laboratory access is closed',
    )
  })

  it('never leaks raw errors', () => {
    expect(errorMessage(new TypeError('x is undefined'))).toBe(
      'Something went wrong. Please try again.',
    )
  })
})
