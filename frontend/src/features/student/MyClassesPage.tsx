import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FlaskConical, GraduationCap, Plus } from 'lucide-react'
import { useMyClasses } from '@/api/queries/myClasses'
import { Button } from '@/components/ui/Button'
import { JoinClassDialog } from './JoinClassDialog'
import { buttonClass } from '@/components/ui/buttonStyles'

/**
 * What the content area shows until a class is chosen in the list on the left: a prompt, not a second copy of
 * the list. (A class is opened from that list.)
 */
export function MyClassesPage() {
  const classes = useMyClasses()
  const [joining, setJoining] = useState(false)
  const items = classes.data ?? []
  const waiting = items.filter((c) => c.status === 'pending').length

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 pt-20 text-center">
      <GraduationCap aria-hidden className="size-14 text-ink-muted/60" />
      <h1 className="text-2xl font-semibold">My classes</h1>

      {classes.isPending ? (
        <p className="text-ink-muted">Loading your classes…</p>
      ) : items.length === 0 ? (
        <p className="text-ink-muted">
          You have not joined a class yet. Your instructor gives you an invite code: enter it to ask
          to join.
        </p>
      ) : (
        <p className="text-ink-muted">Select a class from the list on the left to open it.</p>
      )}

      {waiting > 0 && (
        <p className="text-sm text-ink-muted">
          {waiting === 1
            ? '1 request is waiting for your instructor'
            : `${waiting} requests are waiting for your instructors`}
          . The list updates by itself when you are approved.
        </p>
      )}

      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => setJoining(true)}>
          <Plus aria-hidden className="size-4" />
          Join class
        </Button>
        <Link to="/practice" className={buttonClass('secondary', 'md')}>
          <FlaskConical aria-hidden className="size-4" />
          My workspace
        </Link>
      </div>
      <p className="max-w-sm text-sm text-ink-muted">
        <strong>My workspace</strong> is your own space to write and run Python: nothing in it is
        submitted.
      </p>

      <JoinClassDialog open={joining} onClose={() => setJoining(false)} />
    </div>
  )
}
