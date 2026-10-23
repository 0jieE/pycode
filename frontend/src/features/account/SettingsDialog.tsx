import { useId } from 'react'
import { useUpdatePreferences } from '@/api/queries/auth'
import type { Preferences } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { toast } from '@/components/ui/toastStore'
import { errorMessage } from '@/api/errors'
import { DEFAULT_PREFERENCES } from '@/lib/theme'

interface Choice<T extends string> {
  value: T
  label: string
}

const THEMES: Choice<Preferences['theme']>[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
]

const EDITOR_THEMES: Choice<Preferences['editor_theme']>[] = [
  { value: 'match', label: 'Match theme' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

/**
 * The Settings opened from the gear next to the account badge. A choice takes effect at once and is saved to the
 * account, so it follows the user to any computer.
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, updateUser } = useAuth()
  const update = useUpdatePreferences()
  const prefs = user?.preferences ?? DEFAULT_PREFERENCES

  function choose(patch: Partial<Preferences>) {
    if (!user) return
    const before = user.preferences
    // Show it now; the server's answer confirms it, or the old choice comes back.
    updateUser({ ...user, preferences: { ...before, ...patch } })
    update.mutate(patch, {
      onSuccess: (saved) => updateUser({ ...user, preferences: saved }),
      onError: (err) => {
        updateUser({ ...user, preferences: before })
        toast.error(`The setting could not be saved: ${errorMessage(err)}`)
      },
    })
  }

  return (
    <Dialog open={open} onClose={onClose} title="Settings" width="max-w-md">
      <DialogBody>
        <div className="flex flex-col gap-5">
          <ChoiceGroup
            label="Theme"
            hint="The colours of the whole app. System follows this computer's light or dark setting."
            choices={THEMES}
            value={prefs.theme}
            onChange={(theme) => choose({ theme })}
          />
          <ChoiceGroup
            label="Code editor colours"
            hint="Where you write code: follow the theme, or always dark or light."
            choices={EDITOR_THEMES}
            value={prefs.editor_theme}
            onChange={(editor_theme) => choose({ editor_theme })}
          />
          <p className="text-xs text-ink-muted">
            Saved to your account: it follows you to any computer.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function ChoiceGroup<T extends string>({
  label,
  hint,
  choices,
  value,
  onChange,
}: {
  label: string
  hint: string
  choices: Choice<T>[]
  value: T
  onChange: (value: T) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <p id={`${id}-label`} className="text-sm font-medium">
        {label}
      </p>
      <p className="text-xs text-ink-muted">{hint}</p>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        className="flex rounded-md bg-field p-0.5 text-sm"
      >
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={value === c.value}
            onClick={() => onChange(c.value)}
            className={`h-7 flex-1 rounded px-2 font-medium ${
              value === c.value ? 'bg-brand-600 text-white' : 'text-ink-muted hover:text-ink-strong'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}
