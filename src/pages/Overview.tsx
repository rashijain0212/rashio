import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { useData } from '@/hooks/data'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, Td, Th, Empty } from '@/components/Table'
import { StackedBars, TYPE_SERIES, activeSeries } from '@/components/Charts'
import { cycleBucket, effectiveHourlyCents, groupBy, groupTotals, lifetimeTotals, monthBucket, rangeTotals, upcomingPayouts, emptyTotals, type Totals } from '@/lib/calc'
import { projectRows } from '@/lib/projects'
import { useReconciliation } from '@/components/CloudStatus'
import { AlertTriangle } from 'lucide-react'
import { formatCents } from '@/lib/money'
import { cycleFor, cycleLabel, formatDate, monthLabel, todayISO, addDays, daysInclusive, monthBounds, ordinal } from '@/lib/dates'

function delta(a: number, b: number) {
  if (!b) return null
  const pct = ((a - b) / Math.abs(b)) * 100
  return <span className={pct >= 0 ? 'text-paid-ink' : 'text-danger'}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%</span>
}

function CompareTable({ rows, prevToDate, prevName }: { rows: { label: string; t: Totals }[]; prevToDate: Totals; prevName: string }) {
  return (
    <>
    <Table>
      <thead>
        <tr>
          <Th>Period</Th>
          <Th>Earned</Th>
          <Th className="hidden sm:table-cell">Hours</Th>
          <Th className="hidden sm:table-cell">Paid</Th>
          <Th className="hidden sm:table-cell">Pending</Th>
          <Th className="whitespace-normal sm:hidden">Paid / pending</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, t }, i) => (
          <tr key={label}>
            <Td className="font-medium sm:whitespace-nowrap">
              {label}
              {t.estimated && <span className="ml-1 text-[10px] text-ink-soft" title="Includes day-based estimates for periods crossing boundaries">est.</span>}
            </Td>
            <Td className="num font-semibold whitespace-nowrap">
              {formatCents(t.totalCents)} <span className="block text-[11px] font-normal sm:ml-1 sm:inline" title={`Compared with the same number of days into ${prevName} (${formatCents(prevToDate.totalCents)}), not the full period`}>{i === 0 ? delta(t.totalCents, prevToDate.totalCents) : null}</span>
            </Td>
            <Td className="num hidden sm:table-cell">{t.hours.toFixed(2)}</Td>
            <Td className="num hidden whitespace-nowrap sm:table-cell"><span className="rounded bg-paid px-1 text-paid-ink">{formatCents(t.paidCents)}</span></Td>
            <Td className="num hidden whitespace-nowrap sm:table-cell"><span className="rounded bg-pending px-1 text-pending-ink">{formatCents(t.pendingCents)}</span></Td>
            <Td className="num whitespace-nowrap text-xs sm:hidden">
              <div><span className="rounded bg-paid px-1 text-paid-ink">{formatCents(t.paidCents)}</span></div>
              <div className="mt-0.5"><span className="rounded bg-pending px-1 text-pending-ink">{formatCents(t.pendingCents)}</span></div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
    <p className="mt-1.5 text-[11px] text-ink-soft">Growth compares the current period so far with the same number of days into {prevName} ({formatCents(prevToDate.totalCents)}).</p>
    </>
  )
}

export function Overview() {
  const { payments, meta, settings, loading, imports } = useData()
  const lastImport = imports.find((r) => !r.undone)
  const lastDelta = lastImport && lastImport.totalAfterCents !== undefined && lastImport.totalBeforeCents !== undefined ? lastImport.totalAfterCents - lastImport.totalBeforeCents : null
  const today = todayISO()

  const v = useMemo(() => {
    const life = lifetimeTotals(payments)
    const months = groupTotals(payments, monthBucket)
    const cycles = groupTotals(payments, cycleBucket(settings.cycleStartDay))
    const curMonth = today.slice(0, 7)
    const [py, pm] = curMonth.split('-').map(Number)
    const prevMonth = pm === 1 ? `${py - 1}-12` : `${py}-${String(pm - 1).padStart(2, '0')}`
    const curCycle = cycleFor(today, settings.cycleStartDay)
    const prevCycle = cycleFor(addDays(curCycle.start, -1), settings.cycleStartDay)
    const chart = [...months.entries()].slice(-12).map(([k, t]) => ({
      label: monthLabel(k, true),
      hourly: t.hourlyCents,
      incentive: t.incentiveCents,
      trial: t.trialCents,
      other: t.otherCents,
    }))
    const byContract = [...groupBy(payments, (p) => p.contract).entries()].sort((a, b) => b[1].totalCents - a[1].totalCents)
    // Same elapsed number of days in the previous period, for fair growth comparisons.
    const toDate = (curStart: string, prevStart: string, prevEnd: string) => {
      const elapsed = daysInclusive(curStart, today)
      const end = addDays(prevStart, elapsed - 1)
      return rangeTotals(payments, prevStart, end < prevEnd ? end : prevEnd)
    }
    const [pmStart, pmEnd] = monthBounds(prevMonth)
    return {
      monthPrevToDate: toDate(`${curMonth}-01`, pmStart, pmEnd),
      cyclePrevToDate: toDate(curCycle.start, prevCycle.start, prevCycle.end),
      prevMonthName: monthLabel(prevMonth),
      prevCycleName: cycleLabel(prevCycle.start, prevCycle.end),
      life,
      chart,
      monthRows: [
        { label: monthLabel(curMonth), t: months.get(curMonth) ?? emptyTotals() },
        { label: monthLabel(prevMonth), t: months.get(prevMonth) ?? emptyTotals() },
      ],
      cycleRows: [
        { label: cycleLabel(curCycle.start, curCycle.end), t: cycles.get(curCycle.key) ?? emptyTotals() },
        { label: cycleLabel(prevCycle.start, prevCycle.end), t: cycles.get(prevCycle.key) ?? emptyTotals() },
      ],
      upcoming: upcomingPayouts(payments, today).filter((u) => u.date >= addDays(today, -30)).slice(0, 8),
      byContract,
      projects: projectRows(meta.projects, payments, settings.projectContracts, meta.projectMap),
    }
  }, [payments, settings.cycleStartDay, settings.projectContracts, meta.projects, meta.projectMap, today])

  const hourly = effectiveHourlyCents(v.life)
  const s = meta.summary

  if (!loading && !payments.length) {
    return (
      <>
        <PageHeader title="Overview" subtitle="Earnings attributed by work period" />
        <Card className="p-6 text-center">
          <h2 className="mb-1 text-base font-semibold">No earnings yet</h2>
          <p className="mb-4 text-sm text-ink-soft">Copy your entire earnings page and paste it into Import &amp; Sync.</p>
          <Button asChild variant="accent"><Link to="/import"><RefreshCw /> Import earnings</Link></Button>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={<>{payments.length} payments saved · Last synced {meta.lastSyncAt ? new Date(meta.lastSyncAt).toLocaleString() : 'never'} · attributed by work period</>}
      />

      <ReconBanner />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard tone="total" label="Total earnings" value={formatCents(v.life.totalCents)} sub={lastDelta !== null ? `${lastDelta >= 0 ? '+' : '−'}${formatCents(Math.abs(lastDelta))} since previous import` : `${v.life.count} payments`} />
        <StatCard tone="paid" label="Paid" value={formatCents(v.life.paidCents)} sub={v.life.totalCents ? `${((v.life.paidCents / v.life.totalCents) * 100).toFixed(0)}% of total` : undefined} />
        <StatCard tone="pending" label="Pending" value={formatCents(v.life.pendingCents)} sub="Upcoming / processing" />
        <StatCard tone="hourly" label="Hours worked" value={v.life.hours.toFixed(2)} sub="rounded hours" />
        <StatCard tone="hourly" label="Hourly income" value={formatCents(v.life.hourlyCents)} sub={hourly ? `≈ ${formatCents(hourly)}/hr effective` : undefined} hint="Effective rate = hourly earnings ÷ rounded hours, so it can differ slightly from your contract rate." />
        <StatCard tone="incentive" label="Incentives & trials" value={formatCents(v.life.incentiveCents + v.life.trialCents)} sub={`Trials ${formatCents(v.life.trialCents)}`} />
      </div>

      {s && (
        <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard tone="support" label="Dashboard lifetime" value={formatCents(s.lifetimeCents)} sub={s.lifetimeCents !== null && s.lifetimeCents !== v.life.totalCents ? `Tracked is ${formatCents(Math.abs(v.life.totalCents - s.lifetimeCents))} ${v.life.totalCents < s.lifetimeCents ? 'below' : 'above'} this` : 'Matches your tracked total'} hint={`As shown on the dashboard at the last sync.${s.chartTotalCents != null ? ` The "Earnings over time" chart showed ${formatCents(s.chartTotalCents)} (it refreshes separately).` : ''}`} />
          <StatCard tone="support" label="Current payout" value={formatCents(s.currentPayoutCents)} sub={s.payoutInTransit ?? s.stripeStatus ?? undefined} />
          <StatCard
            tone={s.nextPayoutDate && s.nextPayoutDate < today ? 'pending' : 'support'}
            label="Next payout (dashboard)"
            value={`${s.nextPayoutApprox ? '~' : ''}${formatCents(s.nextPayoutCents)}`}
            sub={s.nextPayoutDate ? (s.nextPayoutDate < today ? `Estimated ${formatDate(s.nextPayoutDate)} — past date, the dashboard's estimate looks stale` : `${s.nextPayoutStatus ?? 'Estimated'} · ${formatDate(s.nextPayoutDate)}`) : undefined}
            hint="As reported by the dashboard. The Upcoming payouts list below is calculated from your saved payments."
          />
          <StatCard tone="support" label="Paid this month" value={formatCents(s.paidThisMonthCents)} sub={s.payoutCount !== null ? `${s.payoutCount} payouts total` : undefined} />
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Monthly earnings</CardTitle>
            <Link to="/monthly" className="flex items-center gap-1 text-xs text-ink-soft hover:text-ink">Details <ArrowRight className="size-3" /></Link>
          </CardHeader>
          <CardContent>
            <StackedBars data={v.chart} series={activeSeries(TYPE_SERIES, v.chart)} height={230} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Upcoming payouts</CardTitle></CardHeader>
          <CardContent>
            {v.upcoming.length ? (
              <Table>
                <thead><tr><Th>Date</Th><Th>Amount</Th></tr></thead>
                <tbody>
                  {v.upcoming.map((u) => (
                    <tr key={u.date}>
                      <Td className="whitespace-nowrap">{formatDate(u.date)}{u.date < today && <span className="ml-1 rounded bg-pending px-1 text-[10px] text-pending-ink">overdue</span>}{u.date === today && <span className="ml-1 rounded bg-hourly px-1 text-[10px]">today</span>}</Td>
                      <Td className="num whitespace-nowrap font-semibold">{formatCents(u.cents)} <span className="ml-1 hidden text-[11px] font-normal text-ink-soft min-[400px]:inline">{u.count} payment{u.count === 1 ? '' : 's'}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <Empty>No pending payouts.</Empty>}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 2xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>This month vs last month</CardTitle></CardHeader>
          <CardContent><CompareTable rows={v.monthRows} prevToDate={v.monthPrevToDate} prevName={v.prevMonthName} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{ordinal(settings.cycleStartDay)}-to-{ordinal(settings.cycleStartDay)} cycles</CardTitle>
            <span className="text-[11px] text-ink-soft">Each cycle runs from the {ordinal(settings.cycleStartDay)} through the {ordinal(settings.cycleStartDay === 1 ? 31 : settings.cycleStartDay - 1)} of the next month</span>
          </CardHeader>
          <CardContent><CompareTable rows={v.cycleRows} prevToDate={v.cyclePrevToDate} prevName={v.prevCycleName} /></CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 2xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Project earnings</CardTitle><span className="text-[11px] text-ink-soft">Tracked from your payments · the dashboard's own total alongside</span></CardHeader>
          <CardContent>
            {v.projects.length ? (
              <Table>
                <thead><tr><Th>Project</Th><Th className="hidden sm:table-cell">Contracts</Th><Th>Tracked</Th><Th>Dashboard</Th><Th className="hidden sm:table-cell">Status</Th></tr></thead>
                <tbody>
                  {v.projects.map((p) => (
                    <tr key={p.name}>
                      <Td className="font-medium">
                        {p.name}
                        {p.active !== null && <div className={`text-[10px] font-normal sm:hidden ${p.active ? 'text-paid-ink' : 'text-ink-soft'}`}>{p.active ? 'Active' : 'Inactive'}</div>}
                      </Td>
                      <Td className="hidden max-w-[12rem] truncate text-xs text-ink-soft sm:table-cell" title={p.contracts.join(', ')}>
                        {p.contracts.length ? p.contracts.join(', ') : <Link to="/settings" className="underline">Map contracts</Link>}
                        {p.source === 'learned' && <span className="ml-1 text-[10px]">(auto)</span>}
                      </Td>
                      <Td className="num font-semibold">{formatCents(p.trackedCents)}</Td>
                      <Td className="num whitespace-nowrap">
                        {formatCents(p.reportedCents)}
                        {p.trackedCents !== null && p.reportedCents !== null && p.trackedCents !== p.reportedCents && (
                          <span className="ml-1 rounded bg-pending px-1 text-[10px] text-pending-ink" title="Tracked payments differ from the dashboard's project card">{p.trackedCents > p.reportedCents ? '+' : '−'}{formatCents(Math.abs(p.trackedCents - p.reportedCents))}</span>
                        )}
                      </Td>
                      <Td className="hidden sm:table-cell">{p.active === null ? '—' : p.active ? <span className="rounded bg-paid px-1.5 text-[11px] text-paid-ink">Active</span> : <span className="rounded bg-support px-1.5 text-[11px] text-ink-soft">Inactive</span>}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="bg-total/60 font-semibold"><Td>Total</Td><Td className="hidden sm:table-cell" /><Td className="num">{formatCents(v.projects.reduce((a, p) => a + (p.trackedCents ?? 0), 0))}</Td><Td className="num">{formatCents(v.projects.reduce((a, p) => a + (p.reportedCents ?? 0), 0))}</Td><Td className="hidden sm:table-cell" /></tr></tfoot>
              </Table>
            ) : <Empty>Project totals appear after your next import of the full earnings page (the project cards are read automatically). You can also map projects to contracts in Settings.</Empty>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Contract earnings</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr><Th>Contract</Th><Th className="hidden sm:table-cell">Hours</Th><Th>Eff. rate</Th><Th>Earned</Th></tr></thead>
              <tbody>
                {v.byContract.map(([c, t]) => (
                  <tr key={c}>
                    <Td className="font-medium">{c}</Td>
                    <Td className="num hidden sm:table-cell">{t.hours ? t.hours.toFixed(2) : '—'}</Td>
                    <Td className="num text-ink-soft">{effectiveHourlyCents(t) ? `${formatCents(effectiveHourlyCents(t))}` : '—'}</Td>
                    <Td className="num font-semibold">{formatCents(t.totalCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function ReconBanner() {
  const { meta, imports } = useData()
  const r = useReconciliation()
  if (r.diff === null || r.diff === 0) return null
  const amt = formatCents(Math.abs(r.diff))
  const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  // Most recent import event: an undo newer than any kept import explains the gap directly.
  const lastKept = imports.find((i) => !i.undone)
  const lastUndo = imports.filter((i) => i.undone && i.undoneAt).sort((a, b) => (b.undoneAt ?? 0) - (a.undoneAt ?? 0))[0]
  const undoIsLatest = !!lastUndo && (!lastKept || (lastUndo.undoneAt ?? 0) > lastKept.createdAt)

  let reason: string
  let action: { to: string; label: string } = { to: '/import', label: 'Paste latest dashboard' }
  if (r.diff > 0 && undoIsLatest) {
    reason = `Your last import was undone on ${when(lastUndo.undoneAt!)}, so its changes were removed. Paste the dashboard again to re-apply them.`
  } else if (r.diff > 0 && r.summaryNewer) {
    reason = 'The latest paste updated the dashboard totals but not the payments. Paste the full page again.'
  } else if (r.diff > 0) {
    reason = 'Some payments are missing — usually older ones that are no longer on the dashboard. Add them in Payments, or paste again if the dashboard was still refreshing.'
    action = { to: '/payments', label: 'Open Payments' }
  } else {
    reason = 'You may have a duplicate or a manual entry the dashboard does not have, or the dashboard has not refreshed yet.'
    action = { to: '/payments', label: 'Open Payments' }
  }
  void meta
  return (
    <div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl bg-pending/70 px-3 py-2.5 text-sm text-pending-ink" role="status">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">
          Tracked total is {amt} {r.diff > 0 ? 'below' : 'above'} the dashboard ({formatCents(r.tracked)} vs {formatCents(r.reported)}).
        </div>
        <div>{reason}</div>
      </div>
      <Link to={action.to} className="shrink-0 rounded-lg bg-white/70 px-2.5 py-1 font-medium text-ink hover:bg-white">{action.label}</Link>
    </div>
  )
}
