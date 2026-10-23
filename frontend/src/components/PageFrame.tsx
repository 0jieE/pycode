import { Outlet } from 'react-router-dom'
import { RoleStatusBar } from './RoleStatusBar'
import { Shell } from './Shell'

/**
 * A page with no list beside it (account settings, the administrator's tables), for every role: the top bar,
 * the icon strip, the page and the status bar.
 */
export function PageFrame() {
  return (
    <Shell>
      <main id="main" className="relative min-w-0 flex-1 overflow-auto bg-canvas p-6">
        <Outlet />
      </main>
      <RoleStatusBar />
    </Shell>
  )
}
