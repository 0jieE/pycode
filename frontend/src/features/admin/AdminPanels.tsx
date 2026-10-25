import { useState } from 'react'
import { GraduationCap, KeyRound, Plus, Presentation } from 'lucide-react'
import { useRegistrationBatches } from '@/api/queries/registration'
import { useStorageLimits } from '@/api/queries/storage'
import { useUserCounts } from '@/api/queries/users'
import { SidePanel, SidePanelLink, SidePanelNote } from '@/components/SidePanel'
import { Skeleton } from '@/components/ui/Spinner'
import { formatBytes } from '@/lib/format'
import {
  STORAGE_ROLE_PAGES,
  USER_ROLE_PAGES,
  codesOfBatch,
  type ManagedRole,
} from '@/lib/adminRoutes'
import { matchesSearch } from '@/lib/tableView'
import { useGenerateCodes } from './generateCodes'

const ROLE_ICON: Record<ManagedRole, typeof GraduationCap> = {
  student: GraduationCap,
  instructor: Presentation,
}

/** Users: the instructors, or the students (with how many there are). The search stays in the page. */
export function UsersPanel() {
  const counts = useUserCounts().data
  return (
    <SidePanel title="Users">
      {USER_ROLE_PAGES.map((p) => (
        <SidePanelLink
          key={p.slug}
          to={`/admin/users/${p.slug}`}
          icon={ROLE_ICON[p.role]}
          label={p.label}
          count={counts ? (p.role === 'student' ? counts.students : counts.instructors) : undefined}
        />
      ))}
    </SidePanel>
  )
}

/** Registration codes: all unused codes, or one batch. + generates codes. */
export function CodesPanel() {
  const batches = useRegistrationBatches()
  const openGenerate = useGenerateCodes((s) => s.open)
  const [search, setSearch] = useState('')
  const all = batches.data ?? []
  const items = all.filter((b) => matchesSearch(b.batch_name, search))
  const total = all.reduce((n, b) => n + b.count, 0)

  return (
    <SidePanel
      title="Batches"
      action={{ label: 'Generate new codes', icon: Plus, onClick: openGenerate }}
      search={
        all.length > 5
          ? { value: search, onChange: setSearch, placeholder: 'Search batches' }
          : undefined
      }
    >
      <SidePanelLink
        to="/admin/registration-codes"
        end
        icon={KeyRound}
        label="All batches"
        count={batches.data ? total : undefined}
      />
      {batches.isPending ? (
        <div className="flex flex-col gap-1.5 px-3 pt-1" role="status" aria-label="Loading batches">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <SidePanelNote>No unused codes. Use + to generate some.</SidePanelNote>
      ) : items.length === 0 ? (
        <SidePanelNote>No batch matches your search.</SidePanelNote>
      ) : (
        <ul>
          {items.map((b) => (
            <li key={b.batch_name}>
              <SidePanelLink
                to={codesOfBatch(b.batch_name)}
                label={b.batch_name}
                sub={`${b.count} unused ${b.count === 1 ? 'code' : 'codes'}`}
              />
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  )
}

/** Storage: the limits of students, or of instructors. */
export function StoragePanel() {
  const limits = useStorageLimits()
  return (
    <SidePanel title="Storage">
      {STORAGE_ROLE_PAGES.map((p) => {
        const l = limits.data?.[p.role]
        return (
          <SidePanelLink
            key={p.slug}
            to={`/admin/storage/${p.slug}`}
            icon={ROLE_ICON[p.role]}
            label={p.label}
            sub={
              l
                ? `${formatBytes(l.max_workspace_bytes)} · ${formatBytes(l.max_file_bytes)}/file · ${l.max_files} files`
                : undefined
            }
          />
        )
      })}
    </SidePanel>
  )
}
