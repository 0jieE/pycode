import { useState } from 'react'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { useDeleteActivity, useSetActivityArchived } from '@/api/queries/activities'
import { errorMessage } from '@/api/errors'
import type { Activity } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/components/ui/toastStore'

interface Props {
  classId: number
  activity: Activity
  size?: 'sm'
  /** After a delete (e.g. leave the editor of an activity that no longer exists). */
  onDeleted?: () => void
}

/**
 * Removing an activity: a draft is deleted; a published one is archived (students stop seeing it, their folder
 * turns read-only, submissions and grades stay) and can be brought back.
 */
export function ActivityLifecycleButtons({ classId, activity: a, size, onDeleted }: Props) {
  const remove = useDeleteActivity(classId)
  const setArchived = useSetActivityArchived(classId)
  const [confirm, setConfirm] = useState<'delete' | 'archive' | null>(null)
  const icon = size === 'sm' ? 'size-3.5' : 'size-4'

  const archive = (archived: boolean) =>
    setArchived.mutate(
      { id: a.id, archived },
      {
        onSuccess: () => {
          setConfirm(null)
          toast.success(
            archived ? `"${a.title}" was archived` : `"${a.title}" is back for students`,
          )
        },
        onError: (err) => {
          setConfirm(null)
          toast.error(errorMessage(err))
        },
      },
    )

  return (
    <>
      {!a.is_published ? (
        <Button size={size} aria-label={`Delete ${a.title}`} onClick={() => setConfirm('delete')}>
          <Trash2 aria-hidden className={icon} />
          Delete
        </Button>
      ) : a.is_archived ? (
        <Button
          size={size}
          aria-label={`Unarchive ${a.title}`}
          loading={setArchived.isPending}
          onClick={() => archive(false)}
        >
          <ArchiveRestore aria-hidden className={icon} />
          Unarchive
        </Button>
      ) : (
        <Button size={size} aria-label={`Archive ${a.title}`} onClick={() => setConfirm('archive')}>
          <Archive aria-hidden className={icon} />
          Archive
        </Button>
      )}

      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this draft?"
        confirmLabel="Delete draft"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(a.id, {
            onSuccess: () => {
              setConfirm(null)
              toast.success(`"${a.title}" was deleted`)
              onDeleted?.()
            },
            onError: (err) => {
              setConfirm(null)
              toast.error(errorMessage(err))
            },
          })
        }
        onCancel={() => setConfirm(null)}
      >
        <strong className="text-ink">{a.title}</strong> was never published, so no student has it.
        It is deleted with its starter files and test cases. This cannot be undone.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'archive'}
        title="Archive this activity?"
        confirmLabel="Archive"
        loading={setArchived.isPending}
        onConfirm={() => archive(true)}
        onCancel={() => setConfirm(null)}
      >
        <p>
          Students stop seeing <strong className="text-ink">{a.title}</strong>: no more Test or
          Submit. Its folder stays in their workspace, read-only.
        </p>
        <p className="mt-2">
          Their submissions and grades are kept, and you can still see them. Unarchive it at any
          time to bring everything back.
        </p>
      </ConfirmDialog>
    </>
  )
}
