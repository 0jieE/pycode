import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from '@/components/ui/toastStore'
import { ApiError, errorMessage } from './errors'

/**
 * Set `meta: { silent: true }` on a query or mutation that shows its own errors inline, or
 * `meta: { silentCodes: ['SOME_CODE'] }` for the errors the page handles itself (the rest are toasted).
 */
function shouldToast(error: unknown, meta: Record<string, unknown> | undefined): boolean {
  if (meta?.silent) return false
  if (
    error instanceof ApiError &&
    Array.isArray(meta?.silentCodes) &&
    (meta.silentCodes as unknown[]).includes(error.code)
  )
    return false
  // A 401 already signed the user out and the login page explains why.
  if (error instanceof ApiError && error.status === 401) return false
  return true
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (shouldToast(error, query.meta)) toast.error(errorMessage(error))
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (shouldToast(error, mutation.meta)) toast.error(errorMessage(error))
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // Client errors (4xx) will not fix themselves; only retry network/server trouble once.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
          failureCount < 1,
      },
    },
  })
}
