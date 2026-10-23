import { Outlet } from 'react-router-dom'
import { RoleStatusBar } from '@/components/RoleStatusBar'
import { InstructorClassPanel } from './InstructorClassPanel'

/** The instructor's pages: the class list on the left, the chosen page next to it, the status bar below. */
export function InstructorBrowserLayout() {
  return (
    <>
      <div className="flex min-h-0 flex-1">
        <InstructorClassPanel />
        <main id="main" className="relative min-w-0 flex-1 overflow-auto bg-canvas p-6">
          <Outlet />
        </main>
      </div>
      <RoleStatusBar />
    </>
  )
}
