import { useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { useAllInviteCodes, useUpdateInviteCode } from '@/api/queries/inviteCodes'
import { errorMessage } from '@/api/errors'
import type { InviteCode } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { Skeleton } from '@/components/ui/Spinner'
import { Switch } from '@/components/ui/Switch'
import { Table, Td, Th } from '@/components/ui/Table'
import { NoMatches, TableToolbar } from '@/components/ui/TableToolbar'
import { inviteCodeStatus } from '@/lib/inviteCode'
import { useTableView } from '@/lib/tableView'
import { formatDateTime } from '@/lib/time'
import { InviteCodeFormDialog } from './InviteCodeFormDialog'

const PAGE_SIZE = 10

export function InviteCodesTab({ classId, archived }: { classId: number; archived: boolean }) {
  const codes = useAllInviteCodes(classId)
  const items = codes.data ?? []
  const view = useTableView(items, {
    pageSize: PAGE_SIZE,
    searchText: (c) => c.code,
    filters: {
      status: (c, v) => inviteCodeStatus(c).label === v,
    },
  })
  const statusLabels = [...new Set(items.map((c) => inviteCodeStatus(c).label))]
  const toggle = useUpdateInviteCode(classId)
  // undefined = closed, null = creating, a code = editing its window.
  const [form, setForm] = useState<InviteCode | null | undefined>(undefined)

  const togglingId = toggle.isPending ? toggle.variables?.id : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-muted">
          Students join a class by typing one of these codes. Each join still needs your approval.
          Turn a code off at any time to stop new joins.
        </p>
        <Button variant="primary" disabled={archived} onClick={() => setForm(null)}>
          <Plus aria-hidden className="size-4" />
          New invite code
        </Button>
      </div>

      {items.length > 0 && (
        <TableToolbar
          what="invite codes"
          placeholder="Part of a code"
          search={view.search}
          onSearch={view.setSearch}
          onFilter={view.setFilter}
          active={view.active}
          onClear={view.clear}
          shown={view.matches.length}
          total={items.length}
          filters={[
            {
              id: 'status',
              label: 'Status',
              value: view.filterValues.status ?? '',
              allLabel: 'Any status',
              options: statusLabels.map((l) => ({ value: l, label: l })),
            },
          ]}
        />
      )}

      {codes.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading invite codes">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : codes.isError && !codes.data ? (
        <EmptyState
          title="Invite codes could not be loaded"
          action={<Button onClick={() => void codes.refetch()}>Try again</Button>}
        >
          {errorMessage(codes.error)}
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState title="No invite codes yet">
          Create a code, give it to your students, and set when it works.
        </EmptyState>
      ) : view.matches.length === 0 ? (
        <NoMatches what="invite codes" onClear={view.clear} />
      ) : (
        <div>
          <Table caption="Invite codes">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Works from – until</Th>
                <Th>Used</Th>
                <Th>Status</Th>
                <Th>On</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((c) => {
                const status = inviteCodeStatus(c)
                return (
                  <tr key={c.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <span
                          className="font-mono text-2xl font-semibold tracking-widest"
                          aria-label={`Code ${c.code.split('').join(' ')}`}
                        >
                          {c.code}
                        </span>
                        <CopyButton text={c.code} label={`Copy code ${c.code}`} />
                      </div>
                    </Td>
                    <Td className="text-ink-muted">
                      <p>{formatDateTime(c.valid_from)}</p>
                      <p>{formatDateTime(c.valid_until)}</p>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {c.use_count} / {c.max_uses ?? '∞'}
                    </Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td>
                      <Switch
                        checked={c.is_active}
                        label={`Code ${c.code} is ${c.is_active ? 'on' : 'off'}`}
                        disabled={togglingId === c.id}
                        onChange={(next) => toggle.mutate({ id: c.id, body: { is_active: next } })}
                      />
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          aria-label={`Edit the window of code ${c.code}`}
                          onClick={() => setForm(c)}
                        >
                          <Pencil aria-hidden className="size-3.5" />
                          Edit window
                        </Button>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>
      )}

      {view.matches.length > 0 && (
        <Pagination
          page={view.page}
          size={PAGE_SIZE}
          total={view.matches.length}
          onPageChange={view.setPage}
        />
      )}

      <InviteCodeFormDialog
        classId={classId}
        open={form !== undefined}
        code={form ?? null}
        onClose={() => setForm(undefined)}
      />
    </div>
  )
}
