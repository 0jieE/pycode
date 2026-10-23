import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react'
import { useDeleteLab, useLab, useLabs } from '@/api/queries/labs'
import { ApiError, errorMessage } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { SidePanel, SidePanelFrame, SidePanelLink, SidePanelNote } from '@/components/SidePanel'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Skeleton } from '@/components/ui/Spinner'
import { toast } from '@/components/ui/toastStore'
import { useIdParam } from '@/lib/params'
import { matchesSearch } from '@/lib/tableView'
import { LabNameDialog } from './LabNameDialog'
import { LabSchedule } from './LabSchedule'

/**
 * The Labs pages: the list of labs as a second side bar, and the chosen lab beside it. A lab is a named computer
 * room that sessions book: administrators add, rename and delete them; everyone sees when each is booked.
 */
export function LabsFrame() {
  return <SidePanelFrame panel={<LabPanel />} />
}

export function LabsIndex() {
  return <ChooseLab />
}

function LabPanel() {
  const isAdmin = useAuth().user?.role === 'admin'
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const labs = useLabs()
  const all = labs.data ?? []
  const items = all.filter((l) => matchesSearch(l.name, search))

  return (
    <SidePanel
      title="Labs"
      action={
        isAdmin
          ? { label: 'Create a lab', icon: Plus, onClick: () => setCreating(true) }
          : undefined
      }
      search={
        all.length > 0
          ? { value: search, onChange: setSearch, placeholder: 'Search labs' }
          : undefined
      }
    >
      {labs.isPending ? (
        <div className="flex flex-col gap-1.5 px-3 pt-1" role="status" aria-label="Loading labs">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : labs.isError && !labs.data ? (
        <div className="px-3 py-2 text-sm">
          <p className="text-error">{errorMessage(labs.error)}</p>
          <Button size="sm" className="mt-2" onClick={() => void labs.refetch()}>
            Try again
          </Button>
        </div>
      ) : all.length === 0 ? (
        <SidePanelNote>
          {isAdmin
            ? 'No labs yet. Use + to add your first room.'
            : 'No labs yet. An administrator adds the computer rooms.'}
        </SidePanelNote>
      ) : items.length === 0 ? (
        <SidePanelNote>No lab matches your search.</SidePanelNote>
      ) : (
        <ul>
          {items.map((l) => (
            <li key={l.id}>
              <SidePanelLink to={`/labs/${l.id}`} label={l.name} />
            </li>
          ))}
        </ul>
      )}
      {isAdmin && <LabNameDialog open={creating} onClose={() => setCreating(false)} />}
    </SidePanel>
  )
}

/** Until a lab is chosen in the list on the left: a prompt, not a second copy of the list. */
function ChooseLab() {
  const labs = useLabs()
  const none = labs.data?.length === 0
  const isAdmin = useAuth().user?.role === 'admin'
  const [creating, setCreating] = useState(false)
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 pt-20 text-center">
      <LayoutGrid aria-hidden className="size-14 text-ink-muted/60" />
      <h1 className="text-2xl font-semibold">Labs</h1>
      <p className="text-ink-muted">
        {labs.isPending
          ? 'Loading the labs…'
          : none
            ? isAdmin
              ? 'There are no labs yet. Add each computer room by name: sessions then book them.'
              : 'There are no labs yet. An administrator adds the computer rooms.'
            : 'Select a lab from the list on the left to see when it is booked.'}
      </p>
      {isAdmin && (
        <div className="mt-2">
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            New lab
          </Button>
          <LabNameDialog open={creating} onClose={() => setCreating(false)} />
        </div>
      )}
    </div>
  )
}

/** One lab: its name (administrators rename or delete it) and the sessions booked in it. */
export function LabDetail() {
  const labId = useIdParam('labId')
  const lab = useLab(labId)
  const isAdmin = useAuth().user?.role === 'admin'
  const navigate = useNavigate()
  const remove = useDeleteLab()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (lab.isPending && labId !== null) return <PageSpinner label="Loading the lab" />
  if (labId === null || lab.isError || !lab.data) {
    const gone = labId === null || (lab.error instanceof ApiError && lab.error.status === 404)
    return (
      <EmptyState
        title={gone ? 'Lab not found' : 'The lab could not be loaded'}
        action={
          gone ? (
            <Link to="/labs" className="font-medium text-brand-700 underline">
              All labs
            </Link>
          ) : (
            <Button onClick={() => void lab.refetch()}>Try again</Button>
          )
        }
      >
        {gone ? 'This lab does not exist any more.' : errorMessage(lab.error)}
      </EmptyState>
    )
  }

  const l = lab.data
  return (
    <div className="page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{l.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Choose this lab for a session under a class&apos;s Sessions tab.
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button onClick={() => setRenaming(true)}>
              <Pencil aria-hidden className="size-4" />
              Rename
            </Button>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden className="size-4" />
              Delete
            </Button>
          </div>
        )}
      </header>

      <section aria-labelledby="schedule-heading" className="flex flex-col gap-2">
        <h2 id="schedule-heading" className="text-lg font-semibold">
          Upcoming sessions
        </h2>
        <p className="text-sm text-ink-muted">
          Every instructor&apos;s sessions in this lab that have not ended. A lab takes one session
          at a time: overlapping bookings are refused.
        </p>
        <LabSchedule labId={l.id} />
      </section>

      {isAdmin && (
        <>
          <LabNameDialog open={renaming} lab={l} onClose={() => setRenaming(false)} />
          <ConfirmDialog
            open={deleting}
            title={`Delete ${l.name}?`}
            confirmLabel="Delete lab"
            destructive
            loading={remove.isPending}
            onConfirm={() =>
              remove.mutate(l.id, {
                onSuccess: () => {
                  setDeleting(false)
                  toast.success(`${l.name} deleted`)
                  navigate('/labs')
                },
                onError: (err) => {
                  setDeleting(false)
                  toast.error(errorMessage(err))
                },
              })
            }
            onCancel={() => setDeleting(false)}
          >
            Past sessions keep their records. A lab with sessions that have not ended yet cannot be
            deleted: move or end those sessions first.
          </ConfirmDialog>
        </>
      )}
    </div>
  )
}
