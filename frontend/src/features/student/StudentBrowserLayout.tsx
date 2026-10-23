import { Outlet } from 'react-router-dom'
import { RoleStatusBar } from '@/components/RoleStatusBar'
import { ClassListPanel } from './ClassListPanel'

/** The student's pages that are not the IDE: the class list on the left, the chosen page, the status bar. */
export function StudentBrowserLayout() {
  return (
    <>
      <div className="flex min-h-0 flex-1">
        <ClassListPanel />
        <main id="main" className="relative min-w-0 flex-1 overflow-auto bg-canvas p-6">
          <Outlet />
        </main>
      </div>
      <RoleStatusBar />
    </>
  )
}
