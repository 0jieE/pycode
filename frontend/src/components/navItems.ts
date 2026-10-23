import {
  BookMarked,
  BookOpen,
  FlaskConical,
  GraduationCap,
  HardDrive,
  KeyRound,
  LayoutGrid,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '@/api/types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    { to: '/admin/users', label: 'Users', icon: Users },
    // One-time codes that let students create their own account.
    { to: '/admin/registration-codes', label: 'Registration Codes', icon: KeyRound },
    // The computer rooms that sessions book.
    { to: '/labs', label: 'Labs', icon: LayoutGrid },
    // How much each workspace may hold, per role.
    { to: '/admin/storage', label: 'Storage', icon: HardDrive },
    // Editing the lessons of the Python Tutorial.
    { to: '/tutorial', label: 'Python Tutorial', icon: BookMarked },
  ],
  instructor: [
    { to: '/classes', label: 'Classes', icon: BookOpen },
    { to: '/labs', label: 'Labs', icon: LayoutGrid },
    { to: '/tutorial', label: 'Python Tutorial', icon: BookMarked },
    // Their own space to try code in: private, not part of any class.
    { to: '/practice', label: 'My workspace', icon: FlaskConical },
  ],
  student: [
    { to: '/my/classes', label: 'My classes', icon: GraduationCap },
    // Lessons with examples to try and an exercise each, at their own pace.
    { to: '/tutorial', label: 'Python Tutorial', icon: BookMarked },
    // Your own space to code in: not part of any class.
    { to: '/practice', label: 'My workspace', icon: FlaskConical },
  ],
}
