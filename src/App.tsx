import { lazy, Suspense, useEffect, useState } from 'react'
import { CLOUD_ONLY, enableCloudOnlyAndReload } from '@/lib/firebase'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, DataProvider, useAuth } from '@/hooks/data'
import { Layout } from '@/components/Layout'
import { ErrorBoundary, lazyPage } from '@/components/ErrorBoundary'
import { Login } from '@/pages/Login'
import { Overview } from '@/pages/Overview'

const Monthly = lazyPage(() => import('@/pages/Monthly'))
const Payments = lazyPage(() => import('@/pages/Payments'))
const ImportSync = lazyPage(() => import('@/pages/ImportSync'))
const Analytics = lazyPage(() => import('@/pages/Analytics'))
const SettingsPage = lazyPage(() => import('@/pages/Settings'))
const Spreadsheets = lazyPage(() => import('@/pages/Spreadsheets'))
const Activity = lazyPage(() => import('@/pages/Activity'))

function Spinner() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-ink-soft">
      <span className="mr-2 size-4 animate-spin rounded-full border-2 border-title border-t-ink" />
      Loading…
    </div>
  )
}

const DemoGate = import.meta.env.DEV ? lazy(() => import('@/dev/DemoGate')) : null

function AppRoutes() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="monthly" element={<Monthly />} />
            <Route path="payments" element={<Payments />} />
            <Route path="import" element={<ImportSync />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="settings" element={<SettingsPage />} />
        <Route path="spreadsheets" element={<Spreadsheets />} />
        <Route path="activity" element={<Activity />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
      </Routes>
    </Suspense>
  )
}

/** Shown when sign-in state cannot be read (browser storage locked or broken). */
function StorageStuck() {
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="max-w-sm rounded-2xl border border-line bg-white p-5 text-sm shadow-sm">
        <h1 className="mb-1 text-base font-semibold">Still loading…</h1>
        <p className="mb-3 text-ink-soft">
          Your browser's local storage is not responding. This can happen right after clearing site data, or when another ChaChing tab is open.
          Your data is safe in the cloud.
        </p>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-ink-soft">
          <li>Close other ChaChing tabs and reload this page, or</li>
          <li>continue without local storage (you will sign in again; nothing is lost).</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg bg-ink px-3 py-2 font-medium text-white" onClick={enableCloudOnlyAndReload}>Continue without local storage</button>
          <button className="rounded-lg border border-line px-3 py-2" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    </div>
  )
}

function Gate() {
  const { user, loading } = useAuth()
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    if (!loading) return
    const t = setTimeout(() => setStuck(true), 8000)
    return () => clearTimeout(t)
  }, [loading])
  if (DemoGate && new URLSearchParams(window.location.search).has('demo')) {
    return <Suspense fallback={<Spinner />}><DemoGate><AppRoutes /></DemoGate></Suspense>
  }
  if (loading) return stuck && !CLOUD_ONLY ? <StorageStuck /> : <Spinner />
  if (!user) return <Login />
  return (
    <DataProvider uid={user.uid}>
      <AppRoutes />
    </DataProvider>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
