import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/data'
import { BrandIcon, Wordmark } from '@/components/Brand'
import { useState } from 'react'
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { auth, USE_EMULATORS } from '@/lib/firebase'

export function Login() {
  const { signIn, error } = useAuth()
  const [busy, setBusy] = useState(false)
  const start = async () => {
    setBusy(true)
    try {
      await signIn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-3xl bg-brand-soft px-6 pt-8 pb-7 text-center">
          <BrandIcon className="mx-auto size-16" />
          <h1 className="mt-4 text-3xl"><Wordmark /></h1>
          <p className="mt-2 text-[15px] italic text-ink">Every hour. Every earning.</p>
          <p className="mt-1 text-sm text-ink-soft">Your personal income intelligence.</p>
        </div>
        <p className="mt-4 px-2 text-center text-sm text-ink">Track your earnings, sync your records, and keep your reporting sheet updated — all in one place.</p>
        <div className="mt-4 rounded-2xl border border-line bg-white p-5">
          <Button className="w-full" size="lg" variant="accent" onClick={start} disabled={busy} aria-busy={busy}>
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden><path fill="#fff" d="M21.35 11.1H12v3.2h5.35c-.5 2.4-2.6 3.7-5.35 3.7a6 6 0 1 1 0-12c1.5 0 2.85.55 3.9 1.45l2.4-2.4A9.4 9.4 0 0 0 12 2.5a9.5 9.5 0 1 0 0 19c5.5 0 9.5-3.85 9.5-9.5 0-.3-.05-.6-.15-.9Z"/></svg>
            {busy ? 'Signing in…' : 'Continue with Google'}
          </Button>
          {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
          <p className="mt-4 flex items-start gap-2 text-xs text-ink-soft">
            <ShieldCheck className="mt-px size-4 shrink-0 text-brand-ink" />
            Your earnings are stored in your own private cloud space. Only you can see them — no tracking, no ads.
          </p>
          {USE_EMULATORS && <EmulatorSignIn />}
        </div>
      </div>
    </div>
  )
}

/** Emulator-only fake Google sign-in used for local end-to-end tests. */
function EmulatorSignIn() {
  const [who, setWho] = useState('tester-a')
  return (
    <div className="mt-4 rounded-lg border border-dashed border-pending-ink/40 bg-pending/40 p-2 text-xs">
      <div className="mb-1 font-semibold">Emulator test sign-in</div>
      <div className="flex gap-1.5">
        <input aria-label="Test user" className="flex-1 rounded border border-line px-2" value={who} onChange={(e) => setWho(e.target.value)} />
        <button
          className="rounded bg-ink px-2 py-1 text-white"
          onClick={() =>
            signInWithCredential(
              auth,
              GoogleAuthProvider.credential(JSON.stringify({ sub: who, email: `${who}@example.test`, email_verified: true, name: who })),
            )
          }
        >
          Sign in as test user
        </button>
      </div>
    </div>
  )
}
