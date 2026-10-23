import { useAuth } from '@/auth/AuthContext'

/** Stand-in for a screen that a later phase builds. Shows who is signed in, to verify auth. */
export function PlaceholderPage({ title, phase }: { title: string; phase: number }) {
  const { user } = useAuth()
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-ink-muted">
        Signed in as <strong className="text-ink">{user?.full_name}</strong> ({user?.role}). This
        screen is built in Phase {phase}.
      </p>
    </div>
  )
}
