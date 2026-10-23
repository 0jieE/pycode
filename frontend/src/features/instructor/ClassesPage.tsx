import { useState } from 'react'
import { BookOpen, Plus } from 'lucide-react'
import { useAllClasses } from '@/api/queries/classes'
import { Button } from '@/components/ui/Button'
import { ClassFormDialog } from './ClassFormDialog'

/**
 * What the content area shows until a class is chosen in the list on the left: a prompt, not a second copy of
 * the list.
 */
export function ClassesPage() {
  const classes = useAllClasses(false)
  const [creating, setCreating] = useState(false)
  const items = classes.data ?? []
  const waiting = items.reduce((sum, c) => sum + c.pending_count, 0)

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 pt-20 text-center">
      <BookOpen aria-hidden className="size-14 text-ink-muted/60" />
      <h1 className="text-2xl font-semibold">Classes</h1>

      {classes.isPending ? (
        <p className="text-ink-muted">Loading your classes…</p>
      ) : items.length === 0 ? (
        <p className="text-ink-muted">
          You have no classes yet. A class holds your students, invite codes, lab sessions and
          activities.
        </p>
      ) : (
        <p className="text-ink-muted">Select a class from the list on the left to open it.</p>
      )}

      {waiting > 0 && (
        <p className="text-sm text-ink-muted">
          {waiting === 1
            ? '1 student is waiting for your approval'
            : `${waiting} students are waiting for your approval`}
          : look for the number beside a class.
        </p>
      )}

      <div className="mt-2">
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus aria-hidden className="size-4" />
          New class
        </Button>
      </div>

      <ClassFormDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
