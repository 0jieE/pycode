import type { Tone } from '@/components/ui/Badge'
import type { InviteCode } from '@/api/types'

export interface CodeStatus {
  label: 'Active' | 'Expired' | 'Not yet valid' | 'Disabled' | 'Used up'
  tone: Tone
}

/**
 * What a student trying this code right now would run into. Same order as the backend's checks
 * (turned off, not yet valid, expired, used up), so the badge always names the reason they'd see.
 */
export function inviteCodeStatus(
  code: Pick<InviteCode, 'is_active' | 'valid_from' | 'valid_until' | 'max_uses' | 'use_count'>,
  now: number = Date.now(),
): CodeStatus {
  if (!code.is_active) return { label: 'Disabled', tone: 'pending' }
  if (now < new Date(code.valid_from).getTime()) return { label: 'Not yet valid', tone: 'warn' }
  if (now > new Date(code.valid_until).getTime()) return { label: 'Expired', tone: 'error' }
  if (code.max_uses !== null && code.use_count >= code.max_uses) {
    return { label: 'Used up', tone: 'warn' }
  }
  return { label: 'Active', tone: 'ok' }
}
