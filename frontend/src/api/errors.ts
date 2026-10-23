/** Every backend error body is `{detail, code}`. Branch on `code`, show `detail`. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: string

  constructor(status: number, code: string, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/** Error codes the backend uses for a session that is no longer valid (all HTTP 401). */
export const SESSION_REPLACED = 'SESSION_REPLACED'
export const NOT_AUTHENTICATED = 'NOT_AUTHENTICATED'

/** A 403 with this code: the account must set a new password before it can do anything else. */
export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED'

export const NETWORK_ERROR = 'NETWORK_ERROR'

function detailToString(detail: unknown): string | null {
  if (typeof detail === 'string' && detail.trim()) return detail
  // FastAPI's default validation shape; our backend overrides it, but stay defensive.
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String(d.msg) : null))
      .filter((s): s is string => !!s)
    if (parts.length) return parts.join('; ')
  }
  return null
}

function fallbackDetail(status: number): string {
  if (status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (status === 413) return 'That is too large to send.'
  if (status >= 500) return 'The server had a problem. Please try again.'
  return `Request failed (${status}).`
}

/** Builds an ApiError from a failed response, tolerating bodies that are not our JSON shape. */
export async function parseApiError(res: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Empty or non-JSON body (e.g. an Nginx error page): fall through to the generic message.
  }

  const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const detail = detailToString(obj.detail) ?? fallbackDetail(res.status)
  const code = typeof obj.code === 'string' && obj.code ? obj.code : `HTTP_${res.status}`
  return new ApiError(res.status, code, detail)
}

export function networkError(): ApiError {
  return new ApiError(
    0,
    NETWORK_ERROR,
    "Can't reach the server. Check your network connection and try again.",
  )
}

/** Text safe to show in a toast for anything that was thrown. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail
  return 'Something went wrong. Please try again.'
}
