import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth'
import { clearIndexedDbPersistence, collection, doc, limit, onSnapshot, orderBy, query, terminate } from 'firebase/firestore'
import { auth, firestore, googleProvider } from '@/lib/firebase'
import { DEFAULT_SETTINGS, type ImportRecord, type Payment, type Settings, type SyncMeta } from '@/lib/types'
import { emptyMeta } from '@/lib/store'

interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthCtx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u)
    setLoading(false)
  }), [])
  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      error,
      signIn: async () => {
        setError(null)
        try {
          await signInWithPopup(auth, googleProvider)
        } catch (e) {
          const code = (e as { code?: string }).code
          if (code === 'auth/popup-blocked') {
            await signInWithRedirect(auth, googleProvider).catch((err) => setError(`Sign-in failed: ${friendlyError(err)}`))
          } else if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found')
            setError('Google sign-in is not enabled for this Firebase project yet.')
          else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request')
            setError((e as Error).message)
        }
      },
      signOut: async () => {
        await signOut(auth)
        // Remove the on-device cache so no financial data remains after logout.
        // Firestore stays the source of truth and reloads on the next sign-in.
        try {
          await terminate(firestore)
          await clearIndexedDbPersistence(firestore)
        } catch {
          /* another tab may still hold the cache; it is user-scoped and protected by rules */
        }
        window.location.assign('/')
      },
    }),
    [user, loading, error],
  )
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

export type CloudStatus = 'connecting' | 'synced' | 'saving' | 'offline' | 'error'

interface DataState {
  uid: string
  payments: Payment[]
  meta: SyncMeta
  settings: Settings
  imports: ImportRecord[]
  /** True until the payments have been confirmed by the server (or a non-empty cache is shown) */
  loading: boolean
  error: string | null
  cloud: CloudStatus
}

const DataCtx = createContext<DataState | null>(null)

export function friendlyError(e: unknown): string {
  const code = (e as { code?: string }).code ?? ''
  if (code.includes('permission-denied')) return 'Access denied by the database. Please sign out and sign in again.'
  if (code.includes('unavailable')) return 'Cannot reach the cloud database. Check your internet connection.'
  if (code.includes('failed-precondition')) return 'The database is not ready. Please refresh the page.'
  if (code.includes('unauthenticated')) return 'Your session expired. Please sign in again.'
  return (e as Error)?.message || 'Unknown database error.'
}

export function DataProvider({ uid, children }: { uid: string; children: ReactNode }) {
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [fromCache, setFromCache] = useState(true)
  const [pending, setPending] = useState(false)
  const [meta, setMeta] = useState<SyncMeta>(emptyMeta())
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [imports, setImports] = useState<ImportRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    const onErr = (e: Error) => setError(friendlyError(e))
    const unsubs = [
      onSnapshot(
        collection(firestore, 'users', uid, 'payments'),
        { includeMetadataChanges: true },
        (s) => {
          setPayments(s.docs.map((d) => ({ ...(d.data() as Omit<Payment, 'id'>), id: d.id })))
          setFromCache(s.metadata.fromCache)
          setPending(s.metadata.hasPendingWrites)
          setError(null)
        },
        onErr,
      ),
      onSnapshot(doc(firestore, 'users', uid, 'meta', 'sync'), (s) => setMeta({ ...emptyMeta(), ...(s.data() as Partial<SyncMeta>) }), onErr),
      onSnapshot(doc(firestore, 'users', uid), (s) => setSettings({ ...DEFAULT_SETTINGS, ...(s.data() as Partial<Settings>) }), onErr),
      onSnapshot(
        query(collection(firestore, 'users', uid, 'imports'), orderBy('createdAt', 'desc'), limit(25)),
        (s) => setImports(s.docs.map((d) => ({ ...(d.data() as Omit<ImportRecord, 'id'>), id: d.id }))),
        onErr,
      ),
    ]
    return () => unsubs.forEach((u) => u())
  }, [uid])

  const value = useMemo<DataState>(() => {
    // Never present "no data" until the server has confirmed it. An empty cached
    // snapshot (new device, cleared storage) keeps the loading state.
    const waitingForServer = payments === null || (fromCache && payments.length === 0 && online)
    const cloud: CloudStatus = error ? 'error' : !online ? 'offline' : pending ? 'saving' : fromCache ? 'connecting' : 'synced'
    return {
      uid,
      payments: payments ?? [],
      meta,
      settings,
      imports,
      loading: waitingForServer && !error,
      error,
      cloud,
    }
  }, [uid, payments, fromCache, pending, online, meta, settings, imports, error])
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>
}

/** Dev-only: render the app from static data without Firestore. */
export function StaticDataProvider({ value, children }: { value: Omit<DataState, 'loading' | 'error' | 'cloud'>; children: ReactNode }) {
  return <DataCtx.Provider value={{ ...value, loading: false, error: null, cloud: 'synced' }}>{children}</DataCtx.Provider>
}

export function useData(): DataState {
  const v = useContext(DataCtx)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}
