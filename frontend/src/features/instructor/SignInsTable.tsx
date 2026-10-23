import { useState } from 'react'
import { useSessionLogins } from '@/api/queries/labs'
import { errorMessage } from '@/api/errors'
import type { LoginOutcome } from '@/api/types'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { Skeleton } from '@/components/ui/Spinner'
import { Table, Td, Th } from '@/components/ui/Table'
import { formatDateTime } from '@/lib/time'

const PAGE_SIZE = 20

const OUTCOME: Record<LoginOutcome, { label: string; tone: Tone; help: string }> = {
  success: { label: 'Signed in', tone: 'ok', help: 'A normal sign-in.' },
  replaced_other_session: {
    label: 'Took over a sign-in',
    tone: 'warn',
    help: 'Signed in here while still active on another computer, which was signed out.',
  },
}

/** Who signed in during the session, and how it went: newest first. */
export function SignInsTable({ sessionId, live }: { sessionId: number; live: boolean }) {
  const [page, setPage] = useState(1)
  const logins = useSessionLogins(sessionId, page, PAGE_SIZE, live)

  if (logins.isPending) return <Skeleton className="h-48 w-full" />
  if (logins.isError && !logins.data) {
    return (
      <EmptyState
        title="The sign-ins could not be loaded"
        action={<Button onClick={() => void logins.refetch()}>Try again</Button>}
      >
        {errorMessage(logins.error)}
      </EmptyState>
    )
  }
  const { items, total } = logins.data
  if (total === 0) {
    return (
      <EmptyState title="No sign-ins yet">
        Every student sign-in while this session is open is listed here.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Table caption="Sign-ins during this session, newest first">
        <thead>
          <tr>
            <Th>Time</Th>
            <Th>Student</Th>
            <Th>Outcome</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => {
            const outcome = OUTCOME[l.outcome]
            return (
              <tr key={l.id}>
                <Td className="whitespace-nowrap">{formatDateTime(l.at)}</Td>
                <Td>
                  <p className="font-medium">{l.student.full_name}</p>
                  <p className="font-mono text-xs text-ink-muted">
                    {l.student.student_no ?? l.student.username}
                  </p>
                </Td>
                <Td>
                  <span title={outcome.help}>
                    <Badge tone={outcome.tone}>{outcome.label}</Badge>
                  </span>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <Pagination page={page} size={PAGE_SIZE} total={total} onPageChange={setPage} />
    </div>
  )
}
