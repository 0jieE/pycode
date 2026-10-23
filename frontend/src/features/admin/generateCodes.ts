import { create } from 'zustand'
import type { GeneratedCodes } from './GenerateCodesDialog'

/**
 * The Generate codes dialog (opened by the page's button and the side bar's +) and the codes it made. These are
 * the only copy of the codes in the clear: held in memory until the admin presses Done, never stored.
 */
export const useGenerateCodes = create<{
  opened: boolean
  open: () => void
  close: () => void
  result: GeneratedCodes | null
  setResult: (result: GeneratedCodes | null) => void
}>((set) => ({
  opened: false,
  open: () => set({ opened: true }),
  close: () => set({ opened: false }),
  result: null,
  setResult: (result) => set({ result }),
}))
