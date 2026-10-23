export type PanelTab = 'terminal' | 'tests'

interface PanelTabsProps {
  active: PanelTab
  onChange: (tab: PanelTab) => void
  /** Small text after "Test results", e.g. "2/3". */
  testsBadge?: string
}

const TAB =
  'border-b py-1.5 text-xs font-medium tracking-wide uppercase focus-visible:outline-offset-2'

/** The panel's tab strip, as in VS Code: TERMINAL | TEST RESULTS. The active one is underlined in blue. */
export function PanelTabs({ active, onChange, testsBadge }: PanelTabsProps) {
  return (
    <div role="tablist" aria-label="Panel" className="flex items-center gap-4">
      <button
        type="button"
        role="tab"
        id="panel-tab-terminal"
        aria-selected={active === 'terminal'}
        onClick={() => onChange('terminal')}
        className={`${TAB} ${
          active === 'terminal'
            ? 'border-focus text-ink-strong'
            : 'border-transparent text-ink-muted hover:text-ink'
        }`}
      >
        Terminal
      </button>
      <button
        type="button"
        role="tab"
        id="panel-tab-tests"
        aria-selected={active === 'tests'}
        onClick={() => onChange('tests')}
        className={`${TAB} flex items-center gap-1.5 ${
          active === 'tests'
            ? 'border-focus text-ink-strong'
            : 'border-transparent text-ink-muted hover:text-ink'
        }`}
      >
        Test results
        {testsBadge && (
          <span className="rounded-full bg-btn-2 px-1.5 text-[11px] font-semibold normal-case">
            {testsBadge}
          </span>
        )}
      </button>
    </div>
  )
}
