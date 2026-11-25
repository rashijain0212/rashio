import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './ErrorBoundary'
import { AutoSheetSync } from './AutoSheetSync'
import { CLOUD_ONLY, enableCloudOnlyAndReload } from '@/lib/firebase'
import { AlertTriangle, BarChart3, CalendarRange, LayoutDashboard, ListChecks, LogOut, RefreshCw, Settings } from 'lucide-react'
import { CloudStatusBadge, SyncSummary } from './CloudStatus'
import { useAuth, useData } from '@/hooks/data'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/monthly', label: 'Monthly', icon: CalendarRange },
  { to: '/payments', label: 'Payments', icon: ListChecks },
  { to: '/import', label: 'Import & Sync', icon: RefreshCw },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Layout() {
  const { user, signOut } = useAuth()
  const { error, loading, payments } = useData()
  const location = useLocation()
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-white px-3 py-4 lg:flex">
        <div className="mb-5 flex items-center gap-2 px-2">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight">Rashio</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-soft hover:bg-support', isActive && 'bg-title font-medium text-ink')
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <SyncSummary />
        <div className="mt-2"><AutoSheetSync /></div>
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-support px-2 py-2">
          {user?.photoURL ? <img src={user.photoURL} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" /> : <div className="size-7 rounded-full bg-title" />}
          <div className="min-w-0 flex-1 text-xs">
            <div className="truncate font-medium">{user?.displayName ?? 'Signed in'}</div>
            <div className="truncate text-ink-soft">{user?.email}</div>
          </div>
          <button onClick={signOut} title="Sign out" aria-label="Sign out" className="rounded p-1 text-ink-soft hover:bg-white">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-6 shrink-0" />
            <span className="truncate whitespace-nowrap font-semibold">Rashio</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <CloudStatusBadge compact />
            <button onClick={signOut} aria-label="Sign out" className="rounded p-1.5 text-ink-soft hover:bg-support">
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-3 pt-3 pb-24 sm:px-5 sm:pt-5 lg:pb-8">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <b>Could not load your saved data.</b> {error}
                {payments.length > 0 && <div className="text-xs">Showing the last copy loaded on this device; changes may not be saved.</div>}
                <div><button className="mt-1 text-xs underline" onClick={() => window.location.reload()}>Retry</button></div>
              </div>
            </div>
          )}
          <div className="mb-2 lg:hidden"><AutoSheetSync /></div>
          {error && !payments.length ? null : loading ? <LoadingDashboard /> : <ErrorBoundary key={location.pathname}><Outlet /></ErrorBoundary>}
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => cn('flex min-w-0 flex-col items-center gap-0.5 py-2 text-[10px] text-ink-soft', isActive && 'text-ink font-semibold')}
            >
              {({ isActive }) => (
                <>
                  <span className={cn('rounded-full px-3 py-0.5', isActive && 'bg-title')}><Icon className="size-4" /></span>
                  {label.split(' ')[0]}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}

function LoadingDashboard() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 10000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div aria-busy="true" aria-label="Loading your saved data">
      {slow && (
        <div className="mb-3 rounded-lg bg-pending/70 px-3 py-2 text-sm text-pending-ink" role="status">
          This is taking longer than usual. Check your internet connection{CLOUD_ONLY ? '' : ', or the browser storage may be locked'}.{' '}
          {!CLOUD_ONLY && <button className="underline" onClick={enableCloudOnlyAndReload}>Continue without local storage</button>}
          {' '}<button className="underline" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
      <div className="mb-4 flex items-center gap-2 rounded-xl bg-title px-4 py-3 text-sm">
        <span className="size-4 animate-spin rounded-full border-2 border-white border-t-ink" />
        Loading your saved earnings from the cloud…
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[74px] animate-pulse rounded-xl bg-support" />)}
      </div>
      <div className="mt-4 h-64 animate-pulse rounded-xl bg-support" />
    </div>
  )
}
