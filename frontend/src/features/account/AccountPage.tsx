import { useAuth } from '@/auth/AuthContext'
import { PasswordForm } from './PasswordForm'
import { ProfileForm } from './ProfileForm'

/** Account settings, for every role: edit the profile, change the password. */
export function AccountPage() {
  const { user } = useAuth()
  if (!user) return null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Account settings</h1>

      <section aria-labelledby="profile-heading" className="flex flex-col gap-4 card p-5">
        <h2 id="profile-heading" className="text-lg font-semibold">
          Profile
        </h2>
        {/* Keyed by the user's data, so a saved change starts the form again from the new values. */}
        <ProfileForm key={`${user.full_name}|${user.username}`} user={user} />
      </section>

      <section aria-labelledby="password-heading" className="flex flex-col gap-4 card p-5">
        <h2 id="password-heading" className="text-lg font-semibold">
          Password
        </h2>
        <PasswordForm
          intro="After you change it, this device stays signed in and every other device is signed out."
          onChanged={() => undefined}
        />
      </section>
    </div>
  )
}
