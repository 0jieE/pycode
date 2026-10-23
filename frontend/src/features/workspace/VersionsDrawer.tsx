import { useState } from 'react'
import { History as HistoryIcon, RotateCcw } from 'lucide-react'
import { useVersion, useVersions } from '@/api/queries/workspace'
import type { WorkspaceScope } from '@/api/workspaceScope'
import { errorMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { Skeleton } from '@/components/ui/Spinner'
import { formatBytes } from '@/lib/format'
import { formatDateTime } from '@/lib/time'
import CodeEditor from './CodeEditor'

interface VersionsDrawerProps {
  scope: WorkspaceScope
  open: boolean
  onClose: () => void
  fileId: number | null
  path: string
  /** Copy a version's text into the editor as an unsaved change. */
  onRestore: (content: string) => void
  /** Restoring edits the file, which is not allowed while the lab is closed. */
  readOnly: boolean
  theme: 'dark' | 'light'
}

export function VersionsDrawer({ open, onClose, ...rest }: VersionsDrawerProps) {
  return (
    <Drawer open={open} onClose={onClose} title={`History: ${rest.path}`}>
      <VersionsBody onClose={onClose} {...rest} />
    </Drawer>
  )
}

function VersionsBody({
  scope,
  fileId,
  path,
  onRestore,
  readOnly,
  theme,
  onClose,
}: Omit<VersionsDrawerProps, 'open'>) {
  const versions = useVersions(scope, fileId)
  const [picked, setPicked] = useState<number | null>(null)
  const items = versions.data?.items ?? []
  // Preview the newest version until the student picks another.
  const selectedId = picked ?? items[0]?.id ?? null
  const preview = useVersion(scope, selectedId)

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[16rem_1fr]">
      <div className="min-h-0 overflow-auto border-r border-line">
        {versions.isPending ? (
          <div className="flex flex-col gap-2 p-3" role="status" aria-label="Loading versions">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : versions.isError ? (
          <p role="alert" className="p-4 text-sm text-error">
            {errorMessage(versions.error)}
          </p>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-ink-muted">
            <HistoryIcon aria-hidden className="mb-2 size-6" />
            <p className="font-medium text-ink">No saved versions yet</p>
            <p className="mt-1">
              Press <kbd className="rounded border border-line px-1">Ctrl</kbd>+
              <kbd className="rounded border border-line px-1">S</kbd> to keep a version of this
              file. Automatic saves do not create versions.
            </p>
          </div>
        ) : (
          <ul aria-label="Saved versions">
            {items.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  aria-pressed={v.id === selectedId}
                  onClick={() => setPicked(v.id)}
                  className={`w-full border-b border-line px-4 py-2.5 text-left text-sm ${
                    v.id === selectedId ? 'bg-brand-50 font-medium' : 'hover:bg-surface-2'
                  }`}
                >
                  <span className="block">{formatDateTime(v.saved_at)}</span>
                  <span className="text-xs text-ink-muted">{formatBytes(v.size_bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
          <p className="text-sm text-ink-muted">Read-only preview</p>
          <Button
            variant="primary"
            size="sm"
            disabled={!preview.data || readOnly}
            title={readOnly ? 'Access is closed: files cannot be changed' : undefined}
            onClick={() => {
              if (!preview.data) return
              onRestore(preview.data.content ?? '')
              onClose()
            }}
          >
            <RotateCcw aria-hidden className="size-3.5" />
            Restore this version
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          {preview.data ? (
            <CodeEditor
              path={path}
              value={preview.data.content ?? ''}
              readOnly
              theme={theme}
              label="Preview of the selected version"
            />
          ) : preview.isError ? (
            <p role="alert" className="p-4 text-sm text-error">
              {errorMessage(preview.error)}
            </p>
          ) : selectedId !== null ? (
            <Skeleton className="m-4 h-40" />
          ) : null}
        </div>
        {preview.data && !readOnly && (
          <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">
            Restoring puts this text in the editor as an unsaved change. Nothing is overwritten
            until it saves.
          </p>
        )}
      </div>
    </div>
  )
}
