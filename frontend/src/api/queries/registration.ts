import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import { fetchAllPages } from './pages'
import type {
  BatchOut,
  RegisterRequest,
  RegistrationCodeCreate,
  RegistrationCodeOut,
  RegistrationCodePage,
  RegistrationCodesCreated,
  RevokeResult,
  Me,
} from '../types'

export const registrationCodesKey = ['registration-codes'] as const

// --------------------------------------------------------------------- the student

/** Public sign-up. The server logs the new student in (it sets the cookie) and returns them. */
export function useRegister() {
  return useMutation({
    // Errors here (bad code, username taken) belong to the form, and nobody is signed in to lose.
    mutationFn: (body: RegisterRequest) =>
      api.post<Me>('/auth/register', { body, skipAuthHandler: true }),
    meta: { silent: true },
  })
}

// ----------------------------------------------------------------------- the admin

export interface CodeListParams {
  page: number
  size: number
  /** '' = every batch. */
  batch: string
}

/** Unused, still valid codes. Never the codes themselves: only their last 4 characters. */
export function useRegistrationCodes(params: CodeListParams) {
  return useQuery({
    queryKey: [...registrationCodesKey, 'list', params],
    queryFn: ({ signal }) =>
      api.get<RegistrationCodePage>('/registration-codes', {
        query: { page: params.page, size: params.size, batch: params.batch },
        signal,
      }),
    placeholderData: keepPreviousData,
    // A code disappears the moment a student uses it: pick that up without a manual reload.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Every unused code, across pages: for the table that is searched and filtered in the browser. Still only
 * hints, never the codes.
 */
export function useAllRegistrationCodes() {
  return useQuery({
    queryKey: [...registrationCodesKey, 'all'],
    queryFn: ({ signal }) =>
      fetchAllPages<RegistrationCodeOut>((page, size) =>
        api.get<RegistrationCodePage>('/registration-codes', {
          query: { page, size },
          signal,
        }),
      ),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function useRegistrationBatches() {
  return useQuery({
    queryKey: [...registrationCodesKey, 'batches'],
    queryFn: ({ signal }) => api.get<BatchOut[]>('/registration-codes/batches', { signal }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Generates codes. The reply is the ONLY time the codes exist in the clear, so it is kept only for
 * as long as the page holds it: `gcTime: 0` stops React Query from caching it afterwards.
 */
export function useCreateRegistrationCodes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: RegistrationCodeCreate) =>
      api.post<RegistrationCodesCreated>('/registration-codes', { body }),
    gcTime: 0,
    onSuccess: () => qc.invalidateQueries({ queryKey: registrationCodesKey }),
    meta: { silent: true },
  })
}

export function useRevokeCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/registration-codes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: registrationCodesKey }),
  })
}

export function useRevokeBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (batch: string) =>
      api.delete<RevokeResult>('/registration-codes', { query: { batch } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: registrationCodesKey }),
  })
}
