import type { ReactNode } from 'react'
import { Button } from './Button'
import { Dialog, DialogBody, DialogFooter } from './Dialog'

interface ConfirmDialogProps {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  /** Red button for actions that are hard to undo. */
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} width="max-w-md">
      <DialogBody>
        <div className="text-sm text-ink-muted">{children}</div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          loading={loading}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
