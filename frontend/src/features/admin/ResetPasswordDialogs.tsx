import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { User } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { copyText } from '@/lib/clipboard'

export function ConfirmResetDialog({
  user,
  loading,
  onConfirm,
  onCancel,
}: {
  user: User | null
  loading: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <ConfirmDialog
      open={user !== null}
      title="Reset password?"
      confirmLabel="Reset password"
      destructive
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      A new temporary password will be made for{' '}
      <strong className="text-ink">{user?.full_name}</strong>. Their old password stops working and
      they are signed out right away.
    </ConfirmDialog>
  )
}

/** Shows the new password exactly once: it is held only in this component's props, never stored. */
export function TemporaryPasswordDialog({
  result,
  onClose,
}: {
  result: { user: User; password: string } | null
  onClose: () => void
}) {
  return (
    <Dialog
      open={result !== null}
      onClose={onClose}
      title="New temporary password"
      width="max-w-md"
    >
      {result && <PasswordBody result={result} onClose={onClose} />}
    </Dialog>
  )
}

function PasswordBody({
  result,
  onClose,
}: {
  result: { user: User; password: string }
  onClose: () => void
}) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)

  async function copy() {
    setCopied((await copyText(result.password)) ? 'yes' : 'failed')
  }

  return (
    <>
      <DialogBody>
        <p className="text-sm">
          Give this password to <strong>{result.user.full_name}</strong> (
          <span className="font-mono">{result.user.username}</span>).
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            aria-label="Temporary password"
            readOnly
            value={result.password}
            onFocus={(e) => e.currentTarget.select()}
            className="h-11 flex-1 rounded-md border border-line bg-surface-2 px-3 font-mono text-lg tracking-wide"
          />
          <Button variant="primary" onClick={() => void copy()}>
            {copied === 'yes' ? (
              <Check aria-hidden className="size-4" />
            ) : (
              <Copy aria-hidden className="size-4" />
            )}
            {copied === 'yes' ? 'Copied' : 'Copy'}
          </Button>
        </div>
        {copied === 'failed' && (
          <p role="alert" className="mt-2 text-sm text-error">
            Copying didn&apos;t work here. Select the password above and copy it by hand.
          </p>
        )}
        <p className="mt-4 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          This password is shown only once. It can&apos;t be looked up later, so copy it before you
          close this window.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </>
  )
}
