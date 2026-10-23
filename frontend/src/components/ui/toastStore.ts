import { create } from 'zustand'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastState {
  toasts: ToastItem[]
  push: (kind: ToastKind, message: string) => void
  dismiss: (id: number) => void
}

let nextId = 1
const DURATION_MS: Record<ToastKind, number> = { success: 4000, info: 5000, error: 8000 }

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    // The same message shown twice (e.g. several failed requests at once) is shown once.
    if (get().toasts.some((t) => t.kind === kind && t.message === message)) return
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }))
    setTimeout(() => get().dismiss(id), DURATION_MS[kind])
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Callable from anywhere, including outside React (the query client's error handlers). */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  info: (message: string) => useToastStore.getState().push('info', message),
  error: (message: string) => useToastStore.getState().push('error', message),
}
