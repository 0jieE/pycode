import { useState, type FormEvent } from 'react'
import { CheckCircle2, Clock } from 'lucide-react'
import { useJoinClass, type JoinResult } from '@/api/queries/myClasses'
import { errorMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'

export function JoinClassDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Join a class" width="max-w-md">
      <JoinForm onClose={onClose} />
    </Dialog>
  )
}

/** What the backend's answer means for the student, in plain words. */
function describeResult(r: JoinResult): { text: string; tone: 'ok' | 'wait' | 'bad' } {
  if (r.status === 'approved') {
    return { text: `You are already in ${r.class_name}.`, tone: 'ok' }
  }
  if (r.status === 'rejected') {
    return {
      text: `Your instructor did not approve your request to join ${r.class_name}. Ask them if this is a mistake.`,
      tone: 'bad',
    }
  }
  if (r.status === 'removed') {
    return {
      text: `You were removed from ${r.class_name}. Ask your instructor to add you again.`,
      tone: 'bad',
    }
  }
  return {
    text: r.created
      ? `Request sent for ${r.class_name}. You can use the class once your instructor approves you.`
      : `You already asked to join ${r.class_name}. Your instructor has not approved it yet.`,
    tone: 'wait',
  }
}

function JoinForm({ onClose }: { onClose: () => void }) {
  const join = useJoinClass()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<JoinResult | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (!clean) {
      setError('Enter the invite code from your instructor.')
      return
    }
    setError(null)
    join.mutate(clean, {
      onSuccess: setResult,
      // The backend explains expired, turned-off, used-up and unknown codes in its own words.
      onError: (err) => setError(errorMessage(err)),
    })
  }

  if (result) {
    const { text, tone } = describeResult(result)
    return (
      <>
        <DialogBody>
          <p
            role="status"
            className={`flex items-start gap-2 rounded-md px-3 py-3 text-sm ${
              tone === 'ok'
                ? 'bg-ok-soft text-ok'
                : tone === 'wait'
                  ? 'bg-open-soft text-open'
                  : 'bg-warn-soft text-warn'
            }`}
          >
            {tone === 'wait' ? (
              <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
            )}
            {text}
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

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody>
        <TextField
          label="Invite code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          error={error}
          placeholder="e.g. 6SQ7ZT9Y"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={32}
          autoFocus
          className="font-mono text-lg tracking-widest"
        />
        <p className="mt-2 text-sm text-ink-muted">
          Your instructor gives you this code. After you join, they approve you before you can use
          the class.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={join.isPending}>
          Join class
        </Button>
      </DialogFooter>
    </form>
  )
}
