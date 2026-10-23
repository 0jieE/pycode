import { ApiError, networkError, parseApiError, PASSWORD_CHANGE_REQUIRED } from './errors'

const BASE = '/api/v1'

type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue>

export interface RequestOptions {
  /** Plain objects are sent as JSON; FormData and Blob are sent as they are. */
  body?: unknown
  query?: QueryParams
  signal?: AbortSignal
  /** For calls whose 401 is an ordinary answer (wrong password), not a lost session. */
  skipAuthHandler?: boolean
}

type UnauthorizedHandler = (error: ApiError) => void
let unauthorizedHandler: UnauthorizedHandler | null = null

/** AuthProvider registers itself here so any 401 anywhere signs the user out. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

type PasswordChangeHandler = () => void
let passwordChangeHandler: PasswordChangeHandler | null = null

/** AuthProvider registers itself here: any 403 PASSWORD_CHANGE_REQUIRED sends the user to change it. */
export function setPasswordChangeHandler(handler: PasswordChangeHandler | null): void {
  passwordChangeHandler = handler
}

/** Same for a refusal that did not come from a fetch (a WebSocket the server would not open). */
export function reportPasswordChangeRequired(): void {
  passwordChangeHandler?.()
}

/** For failures that did not come from a fetch (a WebSocket closed with 4401): same effect as a 401. */
export function reportUnauthorized(code: string, detail: string): void {
  unauthorizedHandler?.(new ApiError(401, code, detail))
}

function buildUrl(path: string, query?: QueryParams): string {
  const url = `${BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

function buildInit(method: string, opts: RequestOptions): RequestInit {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const init: RequestInit = { method, credentials: 'include', signal: opts.signal, headers }
  const { body } = opts
  if (body === undefined) return init
  if (body instanceof FormData || body instanceof Blob) {
    init.body = body
  } else {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  return init
}

async function requestWithStatus<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<{ data: T; status: number }> {
  let res: Response
  try {
    res = await fetch(buildUrl(path, opts.query), buildInit(method, opts))
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw networkError()
  }

  if (!res.ok) {
    const error = await parseApiError(res)
    if (error.status === 401 && !opts.skipAuthHandler) unauthorizedHandler?.(error)
    if (error.status === 403 && error.code === PASSWORD_CHANGE_REQUIRED) passwordChangeHandler?.()
    throw error
  }

  if (res.status === 204) return { data: undefined as T, status: res.status }
  try {
    return { data: (await res.json()) as T, status: res.status }
  } catch {
    throw new ApiError(res.status, 'BAD_RESPONSE', 'The server sent a response we could not read.')
  }
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  return (await requestWithStatus<T>(method, path, opts)).data
}

/** The only place the app talks HTTP. Components use the hooks in `api/queries/`. */
export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, opts),
  post: <T>(path: string, opts?: RequestOptions) => request<T>('POST', path, opts),
  /** For the rare call whose meaning depends on the HTTP status (e.g. 201 created vs 200 existing). */
  postWithStatus: <T>(path: string, opts?: RequestOptions) =>
    requestWithStatus<T>('POST', path, opts),
  put: <T>(path: string, opts?: RequestOptions) => request<T>('PUT', path, opts),
  patch: <T>(path: string, opts?: RequestOptions) => request<T>('PATCH', path, opts),
  delete: <T = void>(path: string, opts?: Omit<RequestOptions, 'body'>) =>
    request<T>('DELETE', path, opts),
}
