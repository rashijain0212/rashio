import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './ErrorBoundary'
import { AutoSheetSync } from './AutoSheetSync'
import { CLOUD_ONLY, enableCloudOnlyAndReload } from '@/lib/firebase'
import { AlertTriangle, BarChart3, CalendarRange, ChevronUp, ClipboardPaste, History, LayoutDashboard, ListChecks, LogOut, MoreHorizontal, Settings, Sheet, X } from 'lucide-react'
import { CloudStatusBadge } from './CloudStatus'
import { BrandIcon, BrandLockup, Wordmark } from './Brand'
import { useAuth, useData } from '@/hooks/data'
import { cn } from '@/lib/utils'

// One place for every destination; "Import earnings" is the single primary action.
const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/monthly', label: 'Monthly', icon: CalendarRange },
  { to: '/payments', label: 'Payments', icon: ListChecks },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/spreadsheets', label: 'Spreadsheets', icon: Sheet },
  { to: '/activity', label: 'Activity', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
]
const MOBILE_MAIN = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/payments', label: 'Payments', icon: ListChecks },
  { to: '/import', label: 'Import', icon: ClipboardPaste },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
]
const MOBILE_MORE = NAV.filter((n) => ['/monthly', '/spreadsheets', '/activity', '/settings'].includes(n.to))

function ProfileMenu({ compact }: { compact?: boolean }) {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const avatar = user?.photoURL ? (
    <img src={user.photoURL} alt="" className="size-7 shrink-0 rounded-full" referrerPolicy="no-referrer" />
  ) : (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-ink">{(user?.displayName ?? 'U').slice(0, 1)}</span>
  )
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn('flex w-full items-center gap-2 rounded-lg text-left hover:bg-support', compact ? 'min-h-11 min-w-11 justify-center p-1' : 'px-2 py-1.5')}
        aria-label="Account menu"
      >
        {avatar}
        {!compact && (
          <>
            <span className="min-w-0 flex-1 text-xs">
              <span className="block truncate font-medium text-ink">{user?.displayName ?? 'My account'}</span>
              <span className="block truncate text-ink-soft">{user?.email}</span>
            </span>
            <ChevronUp className={cn('size-4 text-ink-faint transition-transform', !open && 'rotate-180')} />
          </>
        )}
      </button>
      {open && (
        <div role="menu" className={cn('absolute z-30 w-56 rounded-xl border border-line bg-white p-1 shadow-lg', compact ? 'right-0 top-10' : 'bottom-12 left-0')}>
          <div className="border-b border-line px-3 py-2 text-xs">
            <div className="truncate font-medium text-ink">{user?.displayName}</div>
            <div className="truncate text-ink-soft">{user?.email}</div>
          </div>
          <button role="menuitem" onClick={signOut} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger/10">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
      <button className="absolute inset-0 bg-ink/30" aria-label="Close" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-xl">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-sm font-semibold">More</span>
          <button onClick={onClose} className="rounded p-1.5 hover:bg-support" aria-label="Close"><X className="size-4" /></button>
        </div>
        <nav className="grid gap-1">
          {MOBILE_MORE.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={onClose} className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-3 py-3 text-sm', isActive ? 'bg-brand font-medium' : 'hover:bg-support')}>
              <Icon className="size-5 text-brand-ink" /> {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}

export function Layout() {
  const { error, loading, payments } = useData()
  const location = useLocation()
  const [more, setMore] = useState(false)
  const moreActive = MOBILE_MORE.some((m) => location.pathname.startsWith(m.to))
  useEffect(() => setMore(false), [location.pathname])
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-white px-3 py-4 lg:flex">
        <Link to="/" className="mb-4 px-2" aria-label="ChaChing home"><BrandLockup /></Link>
        <NavLink
          to="/import"
          className={({ isActive }) => cn('mb-4 flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90', isActive && 'ring-2 ring-accent/30')}
        >
          <ClipboardPaste className="size-4" /> Import earnings
        </NavLink>
        <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Workspace</div>
        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-soft hover:bg-support', isActive && 'bg-brand font-medium text-ink')}
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-1"><CloudStatusBadge /></div>
        <div className="mt-2"><AutoSheetSync /></div>
        <div className="mt-2 border-t border-line pt-2"><ProfileMenu /></div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white/90 px-4 py-2 backdrop-blur lg:hidden">
          <Link to="/" className="flex min-w-0 items-center gap-2" aria-label="ChaChing home">
            <BrandIcon className="size-7" small />
            <Wordmark className="text-[16px]" />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <CloudStatusBadge compact />
            <ProfileMenu compact />
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-3 pt-3 pb-24 sm:px-5 sm:pt-5 lg:pb-8">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <b>{error}</b>
                <div className="text-xs">{payments.length > 0 ? 'Showing your last confirmed records on this device. Changes may not save until the connection returns.' : 'Nothing has been changed. Your saved earnings are safe in the cloud.'}</div>
                <div><button className="mt-1 text-xs underline" onClick={() => window.location.reload()}>Try again</button></div>
              </div>
            </div>
          )}
          <div className="mb-2 lg:hidden"><AutoSheetSync /></div>
          {error && !payments.length ? null : loading ? <LoadingDashboard /> : <ErrorBoundary key={location.pathname}><Outlet /></ErrorBoundary>}
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main">
          {MOBILE_MAIN.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cn('flex min-w-0 flex-col items-center gap-0.5 py-2 text-[10px] text-ink-soft', isActive && 'font-semibold text-ink')}>
              {({ isActive }) => (
                <>
                  <span className={cn('rounded-full px-3 py-1', to === '/import' ? 'bg-accent text-white' : isActive && 'bg-brand')}><Icon className="size-4" /></span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className={cn('flex min-w-0 flex-col items-center gap-0.5 py-2 text-[10px] text-ink-soft', moreActive && 'font-semibold text-ink')} aria-haspopup="dialog">
            <span className={cn('rounded-full px-3 py-1', moreActive && 'bg-brand')}><MoreHorizontal className="size-4" /></span>
            More
          </button>
        </nav>
        {more && <MoreSheet onClose={() => setMore(false)} />}
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
          Loading is taking longer than usual. Check your internet connection{CLOUD_ONLY ? '' : ', or the browser storage may be locked'}.{' '}
          {!CLOUD_ONLY && <button className="underline" onClick={enableCloudOnlyAndReload}>Continue without local storage</button>}
          {' '}<button className="underline" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
      <div className="mb-4 flex items-center gap-2 rounded-xl bg-title px-4 py-3 text-sm">
        <span className="size-4 animate-spin rounded-full border-2 border-white border-t-ink" />
        Loading your earnings…
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[74px] animate-pulse rounded-xl bg-support" />)}
      </div>
      <div className="mt-4 h-64 animate-pulse rounded-xl bg-support" />
    </div>
  )
}
