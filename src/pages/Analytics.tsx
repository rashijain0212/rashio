import { useMemo, useState } from 'react'
import { useData } from '@/hooks/data'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { StatCard } from '@/components/StatCard'
import { GroupedBars, StackedBars, TrendLine, TYPE_SERIES, STATUS_SERIES, activeSeries } from '@/components/Charts'
import { Table, Td, Th, Empty } from '@/components/Table'
import { CHART, TYPE_LABEL } from '@/components/labels'
import { allocate, effectiveHourlyCents, groupTotals, monthBucket, rangeTotals, countable } from '@/lib/calc'
import { formatCents } from '@/lib/money'
import { addDays, monthLabel, todayISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { Payment } from '@/lib/types'

const PRESETS = [
  { key: 'all', label: 'All time' },
  { key: '90', label: 'Last 90 days' },
  { key: '180', label: 'Last 6 months' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'custom', label: 'Custom' },
] as const

/** Restrict payments to a range, prorating those that straddle its edges. */
function clip(payments: Payment[], from: string, to: string): Payment[] {
  const bucket = (iso: string) =>
    iso < from ? { key: 'b', start: '0000-01-01', end: addDays(from, -1) }
      : iso > to ? { key: 'a', start: addDays(to, 1), end: '9999-12-31' }
        : { key: 'in', start: from, end: to }
  const out: Payment[] = []
  for (const p of payments) {
    const s = allocate(p, bucket).find((x) => x.key === 'in')
    if (!s) continue
    const all = allocate(p, bucket)
    if (all.length === 1) out.push(p)
    else {
      // keep the in-range share; narrow the work interval to the range
      const ws = p.workStart && p.workStart < from ? from : p.workStart
      const we = p.workEnd && p.workEnd > to ? to : p.workEnd
      out.push({ ...p, earningsCents: s.cents, hours: p.hours === null ? null : s.hours, workStart: ws, workEnd: we, allocation: null })
    }
  }
  return out
}

export default function Analytics() {
  const { payments, meta } = useData()
  const today = todayISO()
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['key']>('all')
  const [from, setFrom] = useState(addDays(today, -90))
  const [to, setTo] = useState(today)

  const [rFrom, rTo] = useMemo((): [string, string] => {
    switch (preset) {
      case 'all': return ['0000-01-01', '9999-12-31']
      case '90': return [addDays(today, -89), today]
      case '180': return [addDays(today, -182), today]
      case 'ytd': return [`${today.slice(0, 4)}-01-01`, today]
      case 'custom': return from <= to ? [from, to] : [to, from]
    }
  }, [preset, from, to, today])

  const v = useMemo(() => {
    const ps = preset === 'all' ? payments : clip(payments, rFrom, rTo)
    const totals = preset === 'all' ? rangeTotals(payments, '0000-01-01', '9999-12-31') : rangeTotals(payments, rFrom, rTo)
    const months = [...groupTotals(ps, monthBucket).entries()]
    const monthly = months.map(([k, t]) => ({
      label: monthLabel(k, true),
      total: t.totalCents, paid: t.paidCents, pending: t.pendingCents,
      hourly: t.hourlyCents, incentive: t.incentiveCents, trial: t.trialCents, other: t.otherCents,
      hours: t.hours, rate: effectiveHourlyCents(t),
    }))
    const contracts = new Map<string, { hourly: number; incentive: number; trial: number; other: number; hours: number; total: number }>()
    for (const p of ps) {
      if (!countable(p)) continue
      const c = contracts.get(p.contract) ?? { hourly: 0, incentive: 0, trial: 0, other: 0, hours: 0, total: 0 }
      const k = p.type === 'work_trial' ? 'trial' : p.type
      c[k] += p.earningsCents
      c.total += p.earningsCents
      if (p.type === 'hourly') c.hours += p.hours ?? 0
      contracts.set(p.contract, c)
    }
    const byContract = [...contracts.entries()].sort((a, b) => b[1].total - a[1].total).map(([label, c]) => ({ label, ...c }))
    return { totals, monthly, byContract }
  }, [payments, preset, rFrom, rTo])

  const t = v.totals
  const projects = meta.projects.filter((p) => p.earningsCents !== null).map((p) => ({ label: p.name, earned: p.earningsCents! }))

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Work-period attribution · ranges prorate periods that cross the edges"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex flex-wrap rounded-lg bg-white p-0.5 text-xs font-medium">
              {PRESETS.map((p) => (
                <button key={p.key} onClick={() => setPreset(p.key)} className={cn('rounded-md px-2.5 py-1.5', preset === p.key ? 'bg-ink text-white' : 'text-ink-soft hover:bg-support')}>{p.label}</button>
              ))}
            </div>
            {preset === 'custom' && (
              <>
                <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto" />
                <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto" />
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard tone="total" label="Earned" value={formatCents(t.totalCents)} sub={t.estimated ? 'Includes prorated periods' : `${t.count} payments`} />
        <StatCard tone="paid" label="Paid" value={formatCents(t.paidCents)} />
        <StatCard tone="pending" label="Pending" value={formatCents(t.pendingCents)} />
        <StatCard tone="hourly" label="Hourly pay" value={formatCents(t.hourlyCents)} sub={`${t.hours.toFixed(2)} h`} />
        <StatCard tone="hourly" label="Effective rate" value={effectiveHourlyCents(t) ? formatCents(effectiveHourlyCents(t)) : '—'} hint="Hourly earnings ÷ rounded hours" />
        <StatCard tone="incentive" label="Incentives & trials" value={formatCents(t.incentiveCents + t.trialCents)} />
      </div>

      {!v.monthly.length ? <div className="mt-4"><Empty>No data in this range.</Empty></div> : (
        <>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Monthly trend · total earned</CardTitle></CardHeader>
              <CardContent><TrendLine data={v.monthly} series={[{ key: 'total', name: 'Total earned', color: CHART.total }]} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Paid vs pending</CardTitle></CardHeader>
              <CardContent><StackedBars data={v.monthly} series={STATUS_SERIES} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Hourly income vs incentives</CardTitle></CardHeader>
              <CardContent><StackedBars data={v.monthly} series={activeSeries(TYPE_SERIES, v.monthly)} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Contracts</CardTitle></CardHeader>
              <CardContent>
                <StackedBars data={v.byContract} series={activeSeries(TYPE_SERIES, v.byContract)} height={Math.max(220, 60 + v.byContract.length * 10)} />
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Projects</CardTitle><span className="text-[11px] text-ink-soft">dashboard snapshot (lifetime, not range-filtered)</span></CardHeader>
              <CardContent>
                {projects.length ? <GroupedBars data={projects} series={[{ key: 'earned', name: 'Earned', color: CHART.total }]} layout="vertical" height={Math.max(120, projects.length * 34 + 40)} /> : <Empty>No project snapshot yet.</Empty>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Monthly table</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <thead><tr><Th>Month</Th><Th>Earned</Th><Th className="hidden min-[400px]:table-cell">Hours</Th><Th>Eff. rate</Th><Th className="hidden sm:table-cell">Incent./trial</Th></tr></thead>
                  <tbody>
                    {v.monthly.map((m) => (
                      <tr key={m.label}>
                        <Td className="whitespace-nowrap font-medium">{m.label}</Td>
                        <Td className="num font-semibold">{formatCents(m.total)}</Td>
                        <Td className="num hidden min-[400px]:table-cell">{m.hours.toFixed(2)}</Td>
                        <Td className="num">{m.rate ? formatCents(m.rate) : '—'}</Td>
                        <Td className="num hidden sm:table-cell">{formatCents(m.incentive + m.trial)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader><CardTitle>Contract breakdown</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <thead><tr><Th>Contract</Th>{(['hourly', 'incentive', 'trial'] as const).map((k) => <Th key={k} className="hidden sm:table-cell">{k === 'trial' ? TYPE_LABEL.work_trial : TYPE_LABEL[k]}</Th>)}<Th className="hidden sm:table-cell">Hours</Th><Th>Eff. rate</Th><Th>Total</Th></tr></thead>
                <tbody>
                  {v.byContract.map((c) => (
                    <tr key={c.label}>
                      <Td className="font-medium">{c.label}</Td>
                      <Td className="num hidden sm:table-cell">{formatCents(c.hourly)}</Td>
                      <Td className="num hidden sm:table-cell">{formatCents(c.incentive)}</Td>
                      <Td className="num hidden sm:table-cell">{formatCents(c.trial)}</Td>
                      <Td className="num hidden sm:table-cell">{c.hours ? c.hours.toFixed(2) : '—'}</Td>
                      <Td className="num">{c.hours ? formatCents(Math.round(c.hourly / c.hours)) : '—'}</Td>
                      <Td className="num font-semibold">{formatCents(c.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}
