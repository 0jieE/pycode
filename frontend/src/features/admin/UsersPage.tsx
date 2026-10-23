import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { HardDrive, KeyRound, Pencil, Upload, UserPlus } from 'lucide-react'
import { useResetPassword, useUpdateUser, useUsers } from '@/api/queries/users'
import { errorMessage } from '@/api/errors'
import type { Role, User } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { Skeleton } from '@/components/ui/Spinner'
import { Table, Td, Th } from '@/components/ui/Table'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import { USER_ROLE_PAGES, roleOfSlug } from '@/lib/adminRoutes'
import { useDebouncedValue } from '@/lib/debounce'
import { formatDateTime } from '@/lib/time'
import { ImportUsersDialog } from './ImportUsersDialog'
import { ConfirmResetDialog, TemporaryPasswordDialog } from './ResetPasswordDialogs'
import { UserFormDialog } from './UserFormDialog'
import { UserStorageDialog } from './UserStorageDialog'

const PAGE_SIZE = 15

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator',
  instructor: 'Instructor',
  student: 'Student',
}

type FormTarget = { user: User | null } | null

/** Everyone, or one role's users (chosen in the side bar, UsersPanel). */
export function UsersPage() {
  const { role: slug } = useParams()
  // A fresh search and page for each role.
  return <UsersList key={slug ?? 'all'} role={roleOfSlug(slug) ?? ''} />
}

function UsersList({ role }: { role: Role | '' }) {
  const { user: me } = useAuth()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search)
  const title = USER_ROLE_PAGES.find((p) => p.role === role)?.label ?? 'All users'

  const users = useUsers({ page, size: PAGE_SIZE, q, role })
  const update = useUpdateUser()
  const reset = useResetPassword()

  const [form, setForm] = useState<FormTarget>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [toDeactivate, setToDeactivate] = useState<User | null>(null)
  const [toReset, setToReset] = useState<User | null>(null)
  const [storageOf, setStorageOf] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState<{ user: User; password: string } | null>(null)

  function setActive(target: User, isActive: boolean) {
    update.mutate(
      { id: target.id, body: { is_active: isActive } },
      {
        onSuccess: () => {
          setToDeactivate(null)
          toast.success(
            isActive
              ? `${target.full_name} is active again`
              : `${target.full_name} was deactivated`,
          )
        },
        onError: (err) => {
          setToDeactivate(null)
          toast.error(errorMessage(err))
        },
      },
    )
  }

  function resetPassword(target: User) {
    reset.mutate(target.id, {
      onSuccess: (res) => {
        setToReset(null)
        setNewPassword({ user: target, password: res.temporary_password })
      },
      onError: () => setToReset(null),
    })
  }

  const items = users.data?.items ?? []
  const filtered = q.trim() !== '' || role !== ''

  return (
    <div className="page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="flex gap-2">
          <Button onClick={() => setImportOpen(true)}>
            <Upload aria-hidden className="size-4" />
            Import CSV
          </Button>
          <Button variant="primary" onClick={() => setForm({ user: null })}>
            <UserPlus aria-hidden className="size-4" />
            New user
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <TextField
            label="Search"
            type="search"
            placeholder="Name, username or student no."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="w-full"
          />
        </div>
      </div>

      {users.isError && !users.data ? (
        <EmptyState
          title="The users could not be loaded"
          action={<Button onClick={() => void users.refetch()}>Try again</Button>}
        >
          {errorMessage(users.error)}
        </EmptyState>
      ) : users.isPending ? (
        <UsersSkeleton />
      ) : items.length === 0 ? (
        <EmptyState title={filtered ? 'No users match' : 'There are no users yet'}>
          {filtered
            ? 'Try a different search or role.'
            : 'Create an account or import a CSV file of students.'}
        </EmptyState>
      ) : (
        <div className={users.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
          <Table caption="User accounts">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Student no.</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <p className="font-medium">{u.full_name}</p>
                    <p className="font-mono text-xs text-ink-muted">{u.username}</p>
                  </Td>
                  <Td>{u.student_no ?? <span className="text-ink-muted">—</span>}</Td>
                  <Td>{ROLE_LABEL[u.role]}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={u.is_active ? 'ok' : 'pending'}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      {u.must_change_password && <Badge tone="warn">Must change password</Badge>}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {formatDateTime(u.created_at)}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        aria-label={`Edit ${u.full_name}`}
                        onClick={() => setForm({ user: u })}
                      >
                        <Pencil aria-hidden className="size-3.5" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        aria-label={`Reset password for ${u.full_name}`}
                        onClick={() => setToReset(u)}
                      >
                        <KeyRound aria-hidden className="size-3.5" />
                        Reset password
                      </Button>
                      {u.role !== 'admin' && (
                        <Button
                          size="sm"
                          aria-label={`Storage of ${u.full_name}`}
                          title="Workspace storage: their own limits and what they use"
                          onClick={() => setStorageOf(u)}
                        >
                          <HardDrive aria-hidden className="size-3.5" />
                          Storage
                        </Button>
                      )}
                      {u.is_active ? (
                        <Button
                          size="sm"
                          aria-label={`Deactivate ${u.full_name}`}
                          disabled={u.id === me?.id}
                          title={
                            u.id === me?.id ? "You can't deactivate your own account" : undefined
                          }
                          onClick={() => setToDeactivate(u)}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          aria-label={`Activate ${u.full_name}`}
                          loading={update.isPending && update.variables?.id === u.id}
                          onClick={() => setActive(u, true)}
                        >
                          Activate
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {users.data && users.data.total > 0 && (
        <Pagination page={page} size={PAGE_SIZE} total={users.data.total} onPageChange={setPage} />
      )}

      <UserFormDialog
        open={form !== null}
        user={form?.user ?? null}
        onClose={() => setForm(null)}
      />
      <ImportUsersDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <UserStorageDialog user={storageOf} onClose={() => setStorageOf(null)} />

      <ConfirmDialog
        open={toDeactivate !== null}
        title="Deactivate this account?"
        confirmLabel="Deactivate"
        destructive
        loading={update.isPending}
        onConfirm={() => toDeactivate && setActive(toDeactivate, false)}
        onCancel={() => setToDeactivate(null)}
      >
        <strong className="text-ink">{toDeactivate?.full_name}</strong> will be signed out right
        away and will not be able to sign in until you activate the account again. Their work is
        kept.
      </ConfirmDialog>

      <ConfirmResetDialog
        user={toReset}
        loading={reset.isPending}
        onConfirm={() => toReset && resetPassword(toReset)}
        onCancel={() => setToReset(null)}
      />
      <TemporaryPasswordDialog result={newPassword} onClose={() => setNewPassword(null)} />
    </div>
  )
}

/** Same row height as real rows, so the table does not jump when data arrives. */
function UsersSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-lg border border-line bg-surface"
      role="status"
      aria-label="Loading users"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-0"
        >
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="ml-auto h-8 w-72" />
        </div>
      ))}
    </div>
  )
}
