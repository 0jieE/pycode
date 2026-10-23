import { GraduationCap, ShieldCheck, UserCog, type LucideIcon } from 'lucide-react'
import type { Role } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { StatusBar, StatusItem } from './StatusBar'

const ROLE: Record<Role, { label: string; icon: LucideIcon }> = {
  admin: { label: 'Administrator', icon: ShieldCheck },
  instructor: { label: 'Instructor', icon: UserCog },
  student: { label: 'Student', icon: GraduationCap },
}

/** The blue strip along the bottom of every page that is not the IDE: who is signed in, and the school. */
export function RoleStatusBar() {
  const { user } = useAuth()
  const role = user ? ROLE[user.role] : null

  return (
    <StatusBar
      left={
        role && (
          <StatusItem icon={<role.icon aria-hidden className="size-3.5" />}>
            {role.label}
          </StatusItem>
        )
      }
      right={<StatusItem>Colegio de Kidapawan · BSIT</StatusItem>}
    />
  )
}
