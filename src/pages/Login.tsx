import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/data'
import { useState } from 'react'
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { auth, USE_EMULATORS } from '@/lib/firebase'

export function Login() {
  const { signIn, error } = useAuth()
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Rashio</h1>
            <p className="text-xs text-ink-soft">Personal earnings, synced and private</p>
          </div>
        </div>
        <div className="mb-5 grid grid-cols-3 gap-1.5 text-center text-[11px] font-medium">
          <div className="rounded-lg bg-total py-2">Earnings</div>
          <div className="rounded-lg bg-paid py-2">Paid</div>
          <div className="rounded-lg bg-pending py-2">Pending</div>
        </div>
        <Button className="w-full" size="lg" onClick={signIn}>
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden><path fill="#fff" d="M21.35 11.1H12v3.2h5.35c-.5 2.4-2.6 3.7-5.35 3.7a6 6 0 1 1 0-12c1.5 0 2.85.55 3.9 1.45l2.4-2.4A9.4 9.4 0 0 0 12 2.5a9.5 9.5 0 1 0 0 19c5.5 0 9.5-3.85 9.5-9.5 0-.3-.05-.6-.15-.9Z"/></svg>
          Continue with Google
        </Button>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        {USE_EMULATORS && <EmulatorSignIn />}
        <p className="mt-4 flex items-start gap-1.5 text-[11px] text-ink-soft">
          <ShieldCheck className="mt-px size-3.5 shrink-0" />
          Your data is stored in your own private Firestore space. No one else can read it.
        </p>
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
