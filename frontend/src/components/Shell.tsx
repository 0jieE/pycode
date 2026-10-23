import type { ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { ActivityBar } from './ActivityBar'
import { Topbar } from './Topbar'

/**
 * The frame of every page, for every role: the top bar, always; the icon strip on the left, always;
 * and whatever the page brings (the class list and the page, or the IDE) in the rest.
 */
export function Shell({ children }: { children?: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Topbar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children ?? <Outlet />}</div>
      </div>
    </div>
  )
}
