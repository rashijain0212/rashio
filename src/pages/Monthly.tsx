import { useMemo, useState } from 'react'
import { useData } from '@/hooks/data'
import { usePaymentActions } from '@/hooks/actions'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { PaymentTable } from '@/components/PaymentTable'
import { StatCard } from '@/components/StatCard'
import { PaymentDialog } from '@/components/PaymentDialog'
import { GroupedBars, StackedBars, TYPE_SERIES, activeSeries } from '@/components/Charts'
import { Empty } from '@/components/Table'
import { allocate, validAllocation, cycleBucket, effectiveHourlyCents, groupTotals, monthBucket } from '@/lib/calc'
import { formatCents } from '@/lib/money'
import { cycleLabel, cycleFor, monthLabel, ordinal } from '@/lib/dates'
import { TYPE_LABEL, STATUS_LABEL, CHART } from '@/components/labels'
import type { Payment } from '@/lib/types'
import { cn } from '@/lib/utils'

type Mode = 'month' | 'cycle'

export default function Monthly() {
  const { payments, settings } = useData()
  const actions = usePaymentActions()
  const [mode, setMode] = useState<Mode>('month')
  const [selected, setSelected] = useState<string | null>(null)
  const [contract, setContract] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Payment | null>(null)

  const bucket = useMemo(() => (mode === 'month' ? monthBucket : cycleBucket(settings.cycleStartDay)), [mode, settings.cycleStartDay])
  const filtered = useMemo(
    () => payments.filter((p) => (!contract || p.contract === contract) && (!type || p.type === type) && (!status || p.status === status)),
    [payments, contract, type, status],
  )
  const groups = useMemo(() => groupTotals(filtered, bucket), [filtered, bucket])
  const keys = [...groups.keys()].reverse()
  const active = selected && groups.has(selected) ? selected : keys[0]
  const label = (k: string) => (mode === 'month' ? monthLabel(k) : (() => { const c = cycleFor(k, settings.cycleStartDay); return cycleLabel(c.start, c.end) })())

  // Rows for the active period: each payment's share of that period.
  const { rows, estimated } = useMemo(() => {
    const rows: Payment[] = []
    const estimated = new Set<string>()
    if (!active) return { rows, estimated }
    for (const p of filtered) {
      const va = validAllocation(p)
      const slices = mode === 'month' && va
        ? va.map((a) => ({ key: a.month, cents: a.cents, hours: a.hours ?? p.hours ?? 0, estimated: false }))
        : allocate(p, bucket)
      const s = slices.find((x) => x.key === active)
      if (!s) continue
      if (slices.length > 1) {
        if (s.estimated) estimated.add(p.id)
        rows.push({ ...p, earningsCents: s.cents, hours: p.hours === null ? null : Math.round(s.hours * 100) / 100 })
      } else rows.push(p)
    }
    return { rows, estimated }
  }, [filtered, active, bucket, mode])

  const t = active ? groups.get(active)! : null
  const chartAll = [...groups.entries()].map(([k, g]) => ({
    label: mode === 'month' ? monthLabel(k, true) : k.slice(5),
    hourly: g.hourlyCents, incentive: g.incentiveCents, trial: g.trialCents, other: g.otherCents,
  }))
  const byContract = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.contract, (m.get(r.contract) ?? 0) + r.earningsCents)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, v]) => ({ label, earned: v }))
  }, [rows])
  const contracts = [...new Set(payments.map((p) => p.contract))].sort()

  return (
    <>
      <PageHeader
        title="Monthly earnings"
        subtitle="Grouped by when the work happened, not when it was paid"
        actions={
          <div className="inline-flex rounded-lg bg-white p-0.5 text-xs font-medium">
            {(['month', 'cycle'] as Mode[]).map((m) => (
              <button key={m} onClick={() => { setMode(m); setSelected(null) }} className={cn('rounded-md px-2.5 py-1.5', mode === m ? 'bg-ink text-white' : 'text-ink-soft hover:bg-support')}>
                {m === 'month' ? 'Calendar months' : `${ordinal(settings.cycleStartDay)} → ${ordinal(settings.cycleStartDay)} cycles`}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select aria-label="Period" value={active ?? ''} onChange={(e) => setSelected(e.target.value)} className="col-span-2 sm:col-span-1">
          {keys.map((k) => <option key={k} value={k}>{label(k)}</option>)}
        </Select>
        <Select aria-label="Contract filter" value={contract} onChange={(e) => setContract(e.target.value)}>
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Select aria-label="Type filter" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>

      {!active || !t ? (
        <Empty>No payments for these filters.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard tone="total" label="Earned" value={formatCents(t.totalCents)} sub={t.estimated ? 'Includes estimated split' : `${t.count} payments`} />
            <StatCard tone="paid" label="Paid" value={formatCents(t.paidCents)} />
            <StatCard tone="pending" label="Pending" value={formatCents(t.pendingCents)} />
            <StatCard tone="hourly" label="Hourly pay" value={formatCents(t.hourlyCents)} sub={effectiveHourlyCents(t) ? `≈ ${formatCents(effectiveHourlyCents(t))}/hr` : undefined} />
            <StatCard tone="hourly" label="Hours" value={t.hours.toFixed(2)} />
            <StatCard tone="incentive" label="Incentives & trials" value={formatCents(t.incentiveCents + t.trialCents)} />
          </div>

          <Card className="mt-3">
            <CardHeader>
              <CardTitle>{label(active)} · payments</CardTitle>
              {estimated.size > 0 && <span className="text-[11px] text-ink-soft">“est.” rows cross the period boundary and are split by days. Edit a payment to enter the exact split.</span>}
            </CardHeader>
            <CardContent>
              <PaymentTable payments={rows} estimatedIds={estimated} onEdit={(p) => setEditing(actions.byId(p.id) ?? p)} onStatus={actions.setStatus} />
            </CardContent>
          </Card>

          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>{mode === 'month' ? 'Months' : 'Cycles'} compared</CardTitle></CardHeader>
              <CardContent><StackedBars data={chartAll.slice(-12)} series={activeSeries(TYPE_SERIES, chartAll)} height={220} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>By contract · {label(active)}</CardTitle></CardHeader>
              <CardContent>
                <GroupedBars data={byContract} series={[{ key: 'earned', name: 'Earned', color: CHART.total }]} layout="vertical" height={Math.max(120, byContract.length * 34 + 40)} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
      <PaymentDialog open={!!editing} initial={editing} onClose={() => setEditing(null)} onSave={actions.save} contracts={contracts} />
    </>
  )
}
