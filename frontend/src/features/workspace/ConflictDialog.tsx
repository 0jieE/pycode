import { useState } from 'react'
import { fetchFile } from '@/api/queries/workspace'
import { errorMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import type { WorkspaceScope } from '@/api/workspaceScope'
import type { Saver } from './saver'
import { useWorkspaceStore } from './workspaceStore'

interface ConflictDialogProps {
  scope: WorkspaceScope
  /** The conflicting file's current path, for the message. */
  pathById: ReadonlyMap<number, string>
  saver: Saver
}

/**
 * Shown when a save is rejected (HTTP 409) because the file changed on the server since this editor
 * loaded it. The student must choose: it cannot be dismissed.
 */
export function ConflictDialog({ scope, pathById, saver }: ConflictDialogProps) {
  const conflictId = useWorkspaceStore(
    (s) => Object.values(s.files).find((f) => f.conflict)?.id ?? null,
  )
  const [busy, setBusy] = useState<'latest' | 'mine' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadLatest(id: number) {
    setBusy('latest')
    setError(null)
    try {
      const latest = await fetchFile(scope, id)
      useWorkspaceStore.getState().replaceFromServer(id, latest.content ?? '', latest.updated_at)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function keepMine(id: number) {
    setBusy('mine')
    setError(null)
    try {
      // Fetch only to learn the current save token; the text in the editor is left alone.
      const latest = await fetchFile(scope, id)
      useWorkspaceStore.getState().adoptToken(id, latest.updated_at)
      await saver.save(id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const path = conflictId === null ? '' : (pathById.get(conflictId) ?? 'this file')

  return (
    <Dialog
      open={conflictId !== null}
      onClose={() => undefined}
      dismissible={false}
      title="This file was changed somewhere else"
      width="max-w-lg"
    >
      {conflictId !== null && (
        <>
          <DialogBody>
            <p className="text-sm">
              <strong className="font-mono">{path}</strong> was saved from another window or device
              after you opened it. Choose which version to keep:
            </p>
            <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-muted">
              <li>
                <strong className="text-ink">Load latest from server</strong> throws away what you
                typed here and shows the saved version.
              </li>
              <li>
                <strong className="text-ink">Keep my version</strong> saves what you see now over
                the other change.
              </li>
            </ul>
            {error && (
              <p role="alert" className="mt-3 text-sm text-error">
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              loading={busy === 'latest'}
              disabled={busy !== null}
              onClick={() => void loadLatest(conflictId)}
            >
              Load latest from server
            </Button>
            <Button
              variant="primary"
              loading={busy === 'mine'}
              disabled={busy !== null}
              onClick={() => void keepMine(conflictId)}
            >
              Keep my version
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  )
}
