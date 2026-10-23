import { create } from 'zustand'

/**
 * Whether the page's second side bar (the class list, or the IDE's explorer) is hidden. Clicking the icon of the
 * page you are on toggles it, like VS Code; going to another page shows it again. Remembered in this browser.
 */
const KEY = 'lab.secondarySidebarHidden.v1'

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

function save(hidden: boolean) {
  try {
    localStorage.setItem(KEY, hidden ? '1' : '0')
  } catch {
    // Storage blocked: the choice simply lasts until the page is reloaded.
  }
}

interface SecondarySidebar {
  hidden: boolean
  toggle: () => void
  show: () => void
}

export const useSecondarySidebar = create<SecondarySidebar>((set, get) => ({
  hidden: load(),
  toggle: () => {
    const hidden = !get().hidden
    save(hidden)
    set({ hidden })
  },
  show: () => {
    if (!get().hidden) return
    save(false)
    set({ hidden: false })
  },
}))
