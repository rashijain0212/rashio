import { Cloud, CloudOff, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useData } from '@/hooks/data'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'

export function timeAgo(ms: number | null): string {
  if (!ms) return 'never'
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function CloudStatusBadge({ className, compact }: { className?: string; compact?: boolean }) {
  const { cloud } = useData()
  const map = {
    synced: { icon: CheckCircle2, text: 'Saved to cloud', cls: 'bg-paid text-paid-ink' },
    saving: { icon: Loader2, text: 'Saving…', cls: 'bg-pending text-pending-ink' },
    connecting: { icon: Cloud, text: 'Connecting…', cls: 'bg-support text-ink-soft' },
    offline: { icon: CloudOff, text: 'Offline — showing last saved copy', cls: 'bg-pending text-pending-ink' },
    error: { icon: AlertTriangle, text: 'Cloud error', cls: 'bg-danger/10 text-danger' },
  }[cloud]
  const Icon = map.icon
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium', map.cls, className)} role="status" aria-live="polite" title={map.text}>
      <Icon className={cn('size-3', cloud === 'saving' && 'animate-spin')} />
      <span className={compact ? 'sr-only sm:not-sr-only' : undefined}>{map.text}</span>
    </span>
  )
}

/** Difference between the dashboard's reported lifetime total and the tracked payments. */
export function useReconciliation() {
  const { payments, meta } = useData()
  const tracked = payments.filter((p) => p.status !== 'failed').reduce((a, p) => a + p.earningsCents, 0)
  const reported = meta.summary?.lifetimeCents ?? null
  const diff = reported === null ? null : reported - tracked
  const summaryNewer = !!meta.lastSummaryAt && (!meta.lastSyncAt || meta.lastSummaryAt > meta.lastSyncAt)
  return { tracked, reported, diff, summaryNewer }
}

export function SyncSummary() {
  const { payments, meta } = useData()
  const r = useReconciliation()
  return (
    <div className="space-y-1 rounded-lg bg-support px-2.5 py-2 text-[11px] text-ink-soft">
      <CloudStatusBadge />
      <div><span className="font-semibold text-ink">{payments.length}</span> payments saved</div>
      <div title={meta.lastSyncAt ? new Date(meta.lastSyncAt).toLocaleString() : undefined}>Payments synced <span className="font-medium text-ink">{timeAgo(meta.lastSyncAt)}</span></div>
      {meta.lastSummaryAt && <div title={new Date(meta.lastSummaryAt).toLocaleString()}>dashboard totals saved <span className="font-medium text-ink">{timeAgo(meta.lastSummaryAt)}</span></div>}
      {r.diff !== null && (
        r.diff === 0
          ? <div className="text-paid-ink">✓ Matches dashboard total</div>
          : <Link to="/" className="block text-pending-ink underline">⚠ {formatCents(Math.abs(r.diff))} {r.diff > 0 ? 'not yet tracked' : 'more than the dashboard'}</Link>
      )}
    </div>
  )
}
