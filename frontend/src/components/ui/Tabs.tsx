import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface TabItem {
  id: string
  label: string
  /** Small number next to the label, e.g. pending requests. Hidden when 0 or undefined. */
  badge?: number
}

interface TabsProps {
  tabs: TabItem[]
  active: string
  onChange: (id: string) => void
  label: string
}

/** Accessible tab strip: arrow keys move between tabs, Home/End jump to the ends. */
export function Tabs({ tabs, active, onChange, label }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(e: KeyboardEvent, index: number) {
    const last = tabs.length - 1
    const next =
      e.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null
    if (next === null) return
    e.preventDefault()
    const target = tabs[next]!
    onChange(target.id)
    refs.current[target.id]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line">
      {tabs.map((tab, i) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el
            }}
            role="tab"
            type="button"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              selected
                ? 'border-brand-600 text-ink-strong'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {tab.label}
            {!!tab.badge && (
              <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
                {tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="pt-5">
      {children}
    </div>
  )
}
