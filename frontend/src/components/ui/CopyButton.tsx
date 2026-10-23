import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyText } from '@/lib/clipboard'
import { Button } from './Button'
import { toast } from './toastStore'

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error("Copying didn't work here. Select the text and copy it by hand.")
    }
  }

  return (
    <Button size="sm" aria-label={label} onClick={() => void copy()}>
      {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}
