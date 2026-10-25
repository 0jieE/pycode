import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useMatches } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { create } from 'zustand'
import { useActivity } from '@/api/queries/activities'
import { useClass } from '@/api/queries/classes'
import { useLab } from '@/api/queries/labs'
import { useLessons, useManageLessons } from '@/api/queries/tutorial'
import { useMonitorSnapshot } from '@/api/queries/monitor'
import { useMyClasses } from '@/api/queries/myClasses'
import { useAuth } from '@/auth/AuthContext'
import { STORAGE_ROLE_PAGES, USER_ROLE_PAGES } from '@/lib/adminRoutes'
import { UserMenu } from './UserMenu'

/** Where a page's own buttons go in the top bar (see TopbarActions). */
const useSlot = create<{ el: HTMLElement | null; set: (el: HTMLElement | null) => void }>(
  (set) => ({
    el: null,
    set: (el) => set({ el }),
  }),
)

/**
 * Puts a page's own buttons (Submit, Instructions...) in the top bar, which is always on screen. Render it
 * anywhere in the page; nothing shows until the bar is there.
 */
export function TopbarActions({ children }: { children: ReactNode }) {
  const el = useSlot((s) => s.el)
  return el ? createPortal(children, el) : null
}

interface Crumb {
  label: string
  to?: string
  /** The page has no heading of its own: this crumb is it. */
  heading?: boolean
}

type Params = Record<string, string | undefined>

/** The path to the current page: for a student My classes › the class › Workspace, for an instructor Classes › the class › ... */
function useCrumbs(): Crumb[] {
  const { pathname, state } = useLocation()
  const params = Object.assign({}, ...useMatches().map((m) => m.params)) as Params
  const classId = params.classId ? Number(params.classId) : null
  const activityId = params.activityId ? Number(params.activityId) : null
  const instructor = pathname.startsWith('/classes')

  const myClasses = useMyClasses({ enabled: !instructor && classId !== null })
  const cls = useClass(classId ?? 0, { enabled: instructor && classId !== null })
  const activity = useActivity(classId ?? 0, instructor ? activityId : null)
  const sessionId = params.sessionId ? Number(params.sessionId) : null
  const session = useMonitorSnapshot(sessionId ?? 0, { enabled: instructor && sessionId !== null })
  const labId = params.labId ? Number(params.labId) : null
  const lab = useLab(labId)
  // The lesson's title: from the same list the tutorial's side bar shows (staff see hidden ones too).
  const { user } = useAuth()
  const inTutorial = pathname.startsWith('/tutorial')
  const studentLessons = useLessons({ enabled: inTutorial && user?.role === 'student' })
  const staffLessons = useManageLessons({ enabled: inTutorial && user?.role !== 'student' })

  if (pathname.startsWith('/account')) return [{ label: 'My account' }]
  if (pathname.startsWith('/admin/users')) {
    const page = USER_ROLE_PAGES.find((p) => p.slug === params.role)
    return page
      ? [{ label: 'Users', to: '/admin/users' }, { label: page.label }]
      : [{ label: 'Users' }]
  }
  if (pathname.startsWith('/admin/registration-codes')) {
    return params.batch
      ? [{ label: 'Registration Codes', to: '/admin/registration-codes' }, { label: params.batch }]
      : [{ label: 'Registration Codes' }]
  }
  if (pathname.startsWith('/admin/storage')) {
    const page = STORAGE_ROLE_PAGES.find((p) => p.slug === params.role)
    return [{ label: 'Storage', to: '/admin/storage' }, { label: page?.label ?? 'Students' }]
  }
  if (inTutorial) {
    const slug = params.slug
    if (!slug) return [{ label: 'Python Tutorial' }]
    const title = (studentLessons.data ?? staffLessons.data ?? []).find(
      (l) => l.slug === slug,
    )?.title
    return [{ label: 'Python Tutorial', to: '/tutorial' }, { label: title ?? 'Lesson' }]
  }
  if (pathname.startsWith('/labs')) {
    if (labId === null) return [{ label: 'Labs' }]
    return [{ label: 'Labs', to: '/labs' }, { label: lab.data?.name ?? 'Lab' }]
  }

  if (instructor) {
    const root: Crumb = { label: 'Classes', to: '/classes' }
    if (classId === null) return [{ label: 'Classes' }]
    const here = `/classes/${classId}`
    const cname: Crumb = { label: cls.data?.name ?? 'Class', to: here }
    const tail = pathname.slice(here.length)
    const activityTitle = activity.data?.title ?? 'Activity'
    const activityHere = `${here}/activities/${activityId}`

    if (tail.startsWith('/activities/new')) {
      return [root, { ...cname, to: `${here}?tab=activities` }, { label: 'New activity' }]
    }
    if (/^\/activities\/\d+\/submissions\/\d+/.test(tail)) {
      return [
        root,
        { ...cname, to: `${here}?tab=activities` },
        { label: activityTitle, to: activityHere },
        { label: 'Submissions', to: `${activityHere}/submissions` },
        { label: 'Submission' },
      ]
    }
    if (/^\/activities\/\d+\/submissions/.test(tail)) {
      return [
        root,
        { ...cname, to: `${here}?tab=activities` },
        { label: activityTitle, to: activityHere },
        { label: 'Submissions' },
      ]
    }
    if (/^\/activities\/\d+/.test(tail)) {
      return [root, { ...cname, to: `${here}?tab=activities` }, { label: activityTitle }]
    }
    if (tail.includes('/monitor')) {
      // Shares the page's own query: "live" only while the session is open.
      const label = session.data
        ? session.data.is_open
          ? 'Live monitor'
          : 'Session view'
        : 'Lab session'
      return [root, { ...cname, to: `${here}?tab=sessions` }, { label }]
    }
    if (tail.includes('/workspace')) {
      // Opened from the live monitor: the path goes back through it, as the old Back link did.
      const backTo = (state as { backTo?: string } | null)?.backTo
      if (backTo?.includes('/monitor')) {
        return [
          root,
          { ...cname, to: `${here}?tab=sessions` },
          { label: 'Live monitor', to: backTo },
          { label: 'Student workspace' },
        ]
      }
      return [root, { ...cname, to: `${here}?tab=students` }, { label: 'Student workspace' }]
    }
    return [root, { label: cname.label }]
  }

  const className = myClasses.data?.find((c) => c.class_id === classId)?.class_name ?? 'Class'
  if (pathname.startsWith('/practice')) return [{ label: 'My workspace', heading: true }]
  if (classId === null) return [{ label: 'My classes' }]
  if (pathname.endsWith('/workspace')) {
    return [
      { label: 'My classes', to: '/my/classes' },
      { label: className, to: `/my/classes/${classId}` },
      { label: 'Workspace' },
    ]
  }
  return [{ label: 'My classes', to: '/my/classes' }, { label: className }]
}

/**
 * The bar along the top of every page: where you are on the left, the page's own
 * buttons and who is signed in on the right.
 */
export function Topbar() {
  const crumbs = useCrumbs()
  const setSlot = useSlot((s) => s.set)

  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-surface px-4 py-1.5">
      <img src="/favicon.svg" alt="" className="size-6 shrink-0" />
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-1.5 text-sm">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <li key={`${i}-${c.label}`} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-muted" />}
                {c.heading ? (
                  <h1 className="truncate text-sm font-semibold text-ink-strong">{c.label}</h1>
                ) : c.to && !last ? (
                  <Link to={c.to} className="truncate text-ink-muted hover:text-ink-strong">
                    {c.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className="truncate text-ink-strong"
                  >
                    {c.label}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      <div ref={setSlot} className="ml-auto flex flex-wrap items-center gap-2" />

      <UserMenu />
    </header>
  )
}
