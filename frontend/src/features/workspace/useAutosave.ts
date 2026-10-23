import { useEffect } from 'react'
import type { Saver } from './saver'
import { dirtyIds, isDirty, useWorkspaceStore } from './workspaceStore'

export const AUTOSAVE_DELAY_MS = 2000

/**
 * Saves a file 2 seconds after the student stops typing in it (no version is created). While
 * `paused` (the laboratory is closed) nothing is sent; typed text stays in memory, and saving resumes
 * by itself when access opens again. Also saves when the tab is hidden or closed.
 */
export function useAutosave(saver: Saver, paused: boolean, delayMs = AUTOSAVE_DELAY_MS): void {
  useEffect(() => {
    if (paused) return

    const timers = new Map<number, number>()
    const schedule = (id: number) => {
      window.clearTimeout(timers.get(id))
      timers.set(
        id,
        window.setTimeout(() => {
          timers.delete(id)
          void saver.save(id)
        }, delayMs),
      )
    }

    const unsubscribe = useWorkspaceStore.subscribe((state, prev) => {
      for (const file of Object.values(state.files)) {
        // Only real typing bumps `rev`; a save or a reload does not start the countdown.
        if (file.rev !== prev.files[file.id]?.rev && isDirty(file)) schedule(file.id)
      }
    })
    // Resuming after a pause: anything typed meanwhile gets saved now.
    dirtyIds(useWorkspaceStore.getState().files).forEach(schedule)

    const flush = () => {
      if (document.visibilityState === 'hidden') void saver.saveAll()
    }
    const flushOnLeave = () => void saver.saveAll()
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', flushOnLeave)

    return () => {
      unsubscribe()
      timers.forEach((t) => window.clearTimeout(t))
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', flushOnLeave)
    }
  }, [saver, paused, delayMs])
}
