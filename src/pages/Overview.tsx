import { useMemo, useState } from 'react'
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
import { timeAgo, useReconciliation } from '@/components/CloudStatus'
import { setReconciliationAccepted } from '@/lib/store'
import { firestoreDb } from '@/lib/firebase'
import { AlertTriangle, CheckCircle2, Sheet } from 'lucide-react'
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
  const { payments, meta, settings, loading, imports, uid } = useData()
  const recon = useReconciliation()
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
          <p className="mb-4 text-sm text-ink-soft">Your earnings will appear here after your first import.</p>
          <Button asChild variant="accent"><Link to="/import"><RefreshCw /> Import earnings</Link></Button>
        </Card>
      </>
    )
  }

  const paidPct = v.life.totalCents ? (v.life.paidCents / v.life.totalCents) * 100 : 0
  const avgAll = v.life.hours > 0 ? Math.round(v.life.totalCents / v.life.hours) : null
  // After "Keep my payments as they are", the dashboard's figures from that paste are not shown.
  const showReported = !!s && !recon.accepted
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <>
      <PageHeader title="Overview" subtitle={<>{dateLine} · {payments.length} saved payments</>} />

      <ReconBanner />

      <Card className="p-4 sm:p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
          <div className="rounded-xl bg-total px-4 py-3.5">
            <div className="text-xs font-medium uppercase tracking-wide text-ink/80">Total earnings · lifetime</div>
            <div className="num mt-1 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{formatCents(v.life.totalCents)}</div>
            <div className="mt-1 text-xs text-ink/80">
              {lastDelta !== null && lastDelta !== 0 ? `${lastDelta > 0 ? '+' : '−'}${formatCents(Math.abs(lastDelta))} from your last import · ` : ''}attributed by work period
            </div>
            <div className="mt-4" aria-label={`Paid ${paidPct.toFixed(1)}%, pending ${(100 - paidPct).toFixed(1)}%`}>
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-white/70">
                <div className="rounded-full bg-[#6FBF7E]" style={{ width: `${paidPct}%` }} />
                <div className="rounded-full bg-[#F0B44C]" style={{ width: `${100 - paidPct}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-ink/80">
                <span><span aria-hidden className="mr-1 inline-block size-2 rounded-full bg-[#6FBF7E]" />Paid {paidPct.toFixed(1)}%</span>
                <span><span aria-hidden className="mr-1 inline-block size-2 rounded-sm bg-[#F0B44C]" />Pending {(100 - paidPct).toFixed(1)}%</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <StatCard tone="paid" label="Paid / released" value={formatCents(v.life.paidCents)} sub="By the platform" hint="Released by the earnings platform. Bank arrival is not tracked and can take a few more days." />
            <StatCard tone="pending" label="Awaiting payment" value={formatCents(v.life.pendingCents)} sub="Upcoming or processing" />
            <StatCard tone="hourly" label="Hours worked" value={`${v.life.hours.toFixed(2)} h`} sub="As rounded by the dashboard" />
            <StatCard tone="hourly" label="Hourly income" value={formatCents(v.life.hourlyCents)} sub={hourly ? `Effective rate ${formatCents(hourly)}/h` : undefined} hint="Effective rate = hourly pay ÷ rounded hours. It can differ slightly from your contract rate." />
            <StatCard tone="incentive" label="Incentives & trials" value={formatCents(v.life.incentiveCents + v.life.trialCents)} sub={v.life.trialCents ? `incl. ${formatCents(v.life.trialCents)} trials` : undefined} />
            <StatCard tone="support" label="Earnings per hour" value={avgAll ? `${formatCents(avgAll)}/h` : '—'} sub="Including incentives & trials" hint="Includes incentives and trials, so it is higher than the effective hourly rate." />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs">
          <ReconStatus />
          <SheetStatus />
        </div>
      </Card>

      {showReported && (
        <Card className="mt-3 px-4 py-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-soft">Imported from your earnings dashboard</div>
            <div className="text-[11px] text-ink-faint">As shown at your last paste{meta.lastSummaryAt ? ` · ${new Date(meta.lastSummaryAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</div>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-[11px] text-ink-soft">Lifetime total</dt><dd className="num font-semibold">{formatCents(s!.lifetimeCents)}</dd></div>
            <div><dt className="text-[11px] text-ink-soft">Current payout</dt><dd className="num font-semibold">{formatCents(s!.currentPayoutCents)}</dd>{s!.payoutInTransit && <dd className="text-[11px] text-ink-soft">{s!.payoutInTransit}</dd>}</div>
            <div>
              <dt className="text-[11px] text-ink-soft">Next payout</dt>
              <dd className="num font-semibold">{s!.nextPayoutApprox ? '~' : ''}{formatCents(s!.nextPayoutCents)}</dd>
              {s!.nextPayoutDate && <dd className={s!.nextPayoutDate < today ? 'text-[11px] text-pending-ink' : 'text-[11px] text-ink-soft'}>{s!.nextPayoutDate < today ? `Estimated ${formatDate(s!.nextPayoutDate, false)} — date has passed` : `Estimated ${formatDate(s!.nextPayoutDate, false)}`}</dd>}
            </div>
            <div><dt className="text-[11px] text-ink-soft">Paid this month</dt><dd className="num font-semibold">{formatCents(s!.paidThisMonthCents)}</dd>{s!.payoutCount !== null && <dd className="text-[11px] text-ink-soft">{s!.payoutCount} payouts total</dd>}</div>
          </dl>
        </Card>
      )}
      {s && recon.accepted && (
        <p className="mt-3 text-xs text-ink-soft">
          Dashboard figures from your last paste are hidden because you kept your saved payments. Paste again to refresh them ·{' '}
          <button className="underline" onClick={() => setReconciliationAccepted(firestoreDb, uid, null)}>show them again</button>
        </p>
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
          <CardHeader><CardTitle>Project earnings</CardTitle><span className="text-[11px] text-ink-soft">Tracked from your payments{recon.accepted ? '' : " · the dashboard's own total alongside"}</span></CardHeader>
          <CardContent>
            {v.projects.length ? (
              <Table>
                <thead><tr><Th>Project</Th><Th className="hidden sm:table-cell">Contracts</Th><Th>Tracked</Th>{!recon.accepted && <Th>Dashboard</Th>}<Th className="hidden sm:table-cell">Status</Th></tr></thead>
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
                      {!recon.accepted && <Td className="num whitespace-nowrap">
                        {formatCents(p.reportedCents)}
                        {p.trackedCents !== null && p.reportedCents !== null && p.trackedCents !== p.reportedCents && (
                          <span className="ml-1 rounded bg-pending px-1 text-[10px] text-pending-ink" title="Tracked payments differ from the dashboard's project card">{p.trackedCents > p.reportedCents ? '+' : '−'}{formatCents(Math.abs(p.trackedCents - p.reportedCents))}</span>
                        )}
                      </Td>}
                      <Td className="hidden sm:table-cell">{p.active === null ? '—' : p.active ? <span className="rounded bg-paid px-1.5 text-[11px] text-paid-ink">Active</span> : <span className="rounded bg-support px-1.5 text-[11px] text-ink-soft">Inactive</span>}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="bg-total/60 font-semibold"><Td>Total</Td><Td className="hidden sm:table-cell" /><Td className="num">{formatCents(v.projects.reduce((a, p) => a + (p.trackedCents ?? 0), 0))}</Td>{!recon.accepted && <Td className="num">{formatCents(v.projects.reduce((a, p) => a + (p.reportedCents ?? 0), 0))}</Td>}<Td className="hidden sm:table-cell" /></tr></tfoot>
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
  const { uid } = useData()
  const [busy, setBusy] = useState(false)
  if (r.diff === null || r.diff === 0 || r.accepted) return null
  const amt = formatCents(Math.abs(r.diff))
  const keep = async () => {
    const ok = window.confirm(
      `Keep your payments as they are?\n\n• Your saved payments stay exactly as they are (${formatCents(r.tracked)}).\n• The dashboard's figures from that paste (${formatCents(r.reported)} lifetime) are hidden, so Overview shows only what your payments add up to.\n• ChaChing stops warning about this ${amt} difference.\n\nPasting the dashboard again brings in fresh figures. You can also show the hidden ones again from Overview.`,
    )
    if (!ok) return
    setBusy(true)
    try {
      await setReconciliationAccepted(firestoreDb, uid, { trackedCents: r.tracked, reportedCents: r.reported! })
    } finally {
      setBusy(false)
    }
  }
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
    reason = 'Possible causes: older payments that are no longer on the dashboard, or dashboard totals that had not refreshed yet. Check Payments, or paste again later.'
    action = { to: '/payments', label: 'Open Payments' }
  } else {
    reason = 'Possible causes: a duplicate or manual entry the dashboard does not have, or dashboard totals that had not refreshed yet.'
    action = { to: '/payments', label: 'Open Payments' }
  }
  void meta
  return (
    <div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl bg-pending/70 px-3 py-2.5 text-sm text-pending-ink" role="status">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">
          Your tracked total differs from the reported total by {amt} ({formatCents(r.tracked)} tracked vs {formatCents(r.reported)} reported).
        </div>
        <div>{reason}</div>
      </div>
      <div className="flex w-full flex-wrap gap-2 pl-6">
        <Link to={action.to} className="rounded-lg bg-white/80 px-2.5 py-1 font-medium text-ink hover:bg-white">{action.label}</Link>
        <button onClick={keep} disabled={busy} className="rounded-lg px-2.5 py-1 font-medium text-pending-ink underline-offset-2 hover:underline disabled:opacity-60">
          Keep my payments as they are
        </button>
      </div>
    </div>
  )
}

function ReconStatus() {
  const r = useReconciliation()
  if (r.diff === null) return <span className="text-ink-soft">Paste your dashboard to compare with reported earnings</span>
  if (r.diff === 0)
    return (
      <span className="inline-flex items-center gap-1.5 text-paid-ink">
        <CheckCircle2 className="size-4" /> Tracked total matches reported earnings
        {r.unlisted > 0 && <span className="text-ink-soft">· the headline also counts {formatCents(r.unlisted)} not listed as a payment yet</span>}
      </span>
    )
  if (r.accepted) return <span className="text-ink-soft">Showing your saved payments only (difference accepted)</span>
  return <span className="inline-flex items-center gap-1.5 text-pending-ink"><AlertTriangle className="size-4" /> Tracked total differs from reported by {formatCents(Math.abs(r.diff))}</span>
}

function SheetStatus() {
  const { settings } = useData()
  const ok = !!settings.sheetsSpreadsheetId && settings.sheetsFileAccess === true
  return (
    <Link to="/spreadsheets" className="inline-flex items-center gap-1.5 text-ink-soft hover:text-ink">
      <Sheet className="size-4" />
      {!ok ? 'Spreadsheet not connected' : settings.sheetsLastError ? <span className="text-pending-ink">Spreadsheet needs attention</span> : `Spreadsheet updated ${settings.sheetsLastSyncAt ? timeAgo(settings.sheetsLastSyncAt) : 'not yet'}`}
      <ArrowRight className="size-3" />
    </Link>
  )
}
