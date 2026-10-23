import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useToastStore, type ToastKind } from './toastStore'

const STYLES: Record<ToastKind, { box: string; icon: string; Icon: typeof Info }> = {
  success: { box: 'border-l-ok', icon: 'text-ok', Icon: CheckCircle2 },
  error: { box: 'border-l-error', icon: 'text-error', Icon: AlertCircle },
  info: { box: 'border-l-open', icon: 'text-open', Icon: Info },
}

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  return (
    // Bottom-centre: pages keep their action buttons at the right edge and the sign-out button sits
    // bottom-left, so a toast here never covers something the user is about to click.
    <div className="pointer-events-none fixed bottom-9 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {toasts.map(({ id, kind, message }) => {
        const { box, icon, Icon } = STYLES[kind]
        return (
          <div
            key={id}
            // Errors interrupt a screen reader; the rest wait their turn.
            role={kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-md border border-l-4 border-line bg-surface px-3 py-2.5 text-sm text-ink shadow-xl ${box}`}
          >
            <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${icon}`} />
            <p className="flex-1">{message}</p>
            <button
              type="button"
              aria-label="Dismiss message"
              onClick={() => dismiss(id)}
              className="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
