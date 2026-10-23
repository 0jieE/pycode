import type { Usage } from '@/api/types'
import { formatBytes } from '@/lib/format'

/**
 * How full the workspace is, from the tree's `usage` (the limits that apply to this user). Amber past 80%, red past
 * 95%. An admin can lower a limit below what is already stored: then it says so, as saves that grow it are refused.
 */
export function QuotaBar({ usage }: { usage: Usage }) {
  const ratio = (used: number, max: number) => (max > 0 ? used / max : 0)
  const bytesRatio = ratio(usage.bytes, usage.max_bytes)
  const worst = Math.max(bytesRatio, ratio(usage.files, usage.max_files))
  const over = usage.bytes > usage.max_bytes || usage.files > usage.max_files
  const color = worst >= 0.95 ? 'bg-error' : worst >= 0.8 ? 'bg-warn' : 'bg-ok'

  return (
    <div
      className="border-t border-line px-3 py-2 text-xs text-ink-muted"
      title={`Up to ${formatBytes(usage.max_file_bytes)} per file`}
    >
      <div className="flex justify-between">
        <span>
          {formatBytes(usage.bytes)} of {formatBytes(usage.max_bytes)}
        </span>
        <span>
          {usage.files}/{usage.max_files} files
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Workspace storage used"
        aria-valuemin={0}
        aria-valuemax={usage.max_bytes}
        aria-valuenow={usage.bytes}
        aria-valuetext={`${formatBytes(usage.bytes)} of ${formatBytes(usage.max_bytes)} used`}
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div
          className={`h-full ${color}`}
          style={{ width: `${Math.min(100, bytesRatio * 100)}%` }}
        />
      </div>
      {over && (
        <p role="status" className="mt-1 font-medium text-error">
          Over the limit: delete or shorten files to save bigger changes again.
        </p>
      )}
    </div>
  )
}
