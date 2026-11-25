import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardPaste, Info, ShieldCheck, Upload } from 'lucide-react'
import { friendlyError, useData } from '@/hooks/data'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, Textarea } from '@/components/ui/input'
import { Table, Td, Th, Empty } from '@/components/Table'
import { StatusBadge, TypeBadge, STATUS_LABEL } from '@/components/labels'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/StatCard'
import { parseDashboardText } from '@/lib/parser'
import { applyPlan, finalState, metaChanges, planImport, reconcile, validateResolutions, type PlanItem } from '@/lib/sync'
import { commitImportEx, ConflictError } from '@/lib/store'
import { lifetimeTotals } from '@/lib/calc'
import { inferProjectMap } from '@/lib/projects'
import { markSheetSynced, useSheetsSync } from '@/hooks/sheets'
import { isStaleProjects } from '@/lib/sync'
import { firestoreDb } from '@/lib/firebase'
import { formatCents } from '@/lib/money'
import { formatDate, formatRange } from '@/lib/dates'
import type { ParseResult, Payment, ReconciliationLine } from '@/lib/types'
import { cn } from '@/lib/utils'

const signed = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatCents(Math.abs(c))}`
const signedH = (h: number) => `${h > 0 ? '+' : h < 0 ? '−' : ''}${Math.abs(h).toFixed(2)} h`

function ChangeRow({ it, choice }: { it: PlanItem; choice?: React.ReactNode }) {
  const p = it.incoming
  const e = it.existing
  const ch = Object.fromEntries(it.changes.map((c) => [c.field, c]))
  const dEarn = e ? p.earningsCents - e.earningsCents : p.earningsCents
  const dHours = e && e.hours !== null && p.hours !== null ? p.hours - e.hours : p.hours ?? 0
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-2.5 py-2 text-[13px] first:border-t-0">
      <div className="min-w-[11rem] flex-1">
        <div className="flex flex-wrap items-center gap-1.5 font-medium">
          {e?.contract ?? p.contract}
          <TypeBadge type={p.type} />
          {it.kind === 'new' && it.newContract && <Badge tone="title">New contract</Badge>}
        </div>
        <div className="text-xs text-ink-soft">
          {p.workStart ? formatRange(p.workStart, p.workEnd) : `Payout ${formatDate(p.payoutDate)}`}
          {it.alias && <span title={`Name on the dashboard: ${it.alias.from}`}> · shown as: {it.alias.from.length > 34 ? `${it.alias.from.slice(0, 32)}…` : it.alias.from}</span>}
          {it.reason && <span className="italic"> · {it.reason}</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {it.kind === 'new' ? (
          <span className="rounded bg-total px-1.5 py-0.5 font-semibold">{formatCents(p.earningsCents)}</span>
        ) : (
          <>
            {ch.earningsCents && (
              <span className="rounded bg-total px-1.5 py-0.5">
                {formatCents(ch.earningsCents.from as number)} <ArrowRight className="inline size-3" /> <b>{formatCents(p.earningsCents)}</b>{' '}
                <span className={dEarn >= 0 ? 'text-paid-ink' : 'text-danger'}>({signed(dEarn)})</span>
              </span>
            )}
            {ch.hours && (
              <span className="rounded bg-hourly px-1.5 py-0.5">
                {(ch.hours.from as number | null)?.toFixed(2) ?? '—'} <ArrowRight className="inline size-3" /> <b>{p.hours?.toFixed(2)} h</b>{' '}
                <span className={dHours >= 0 ? 'text-paid-ink' : 'text-danger'}>({signedH(dHours)})</span>
              </span>
            )}
            {ch.status && (
              <span className="inline-flex items-center gap-1">
                <StatusBadge status={ch.status.from as Payment['status']} /> <ArrowRight className="size-3" /> <StatusBadge status={p.status} label={p.statusLabel} />
              </span>
            )}
            {ch.payoutDate && <span className="rounded bg-support px-1.5 py-0.5">Payout {formatDate(ch.payoutDate.from as string)} → {formatDate(p.payoutDate)}</span>}
            {ch.releaseDate && !ch.status && <span className="rounded bg-support px-1.5 py-0.5">Release {formatDate(p.releaseDate)}</span>}
            {it.kind === 'unchanged' && <span className="text-ink-soft">{formatCents(p.earningsCents)}</span>}
          </>
        )}
        {it.kind === 'new' && <StatusBadge status={p.status} label={p.statusLabel} />}
        {it.kind === 'new' && p.hours !== null && p.type === 'hourly' && <span className="rounded bg-hourly px-1.5 py-0.5">{p.hours.toFixed(2)} h</span>}
      </div>
      {choice && <div className="w-full">{choice}</div>}
    </div>
  )
}

function Reconciliation({ lines }: { lines: ReconciliationLine[] }) {
  if (!lines.length) return null
  return (
    <Table>
      <thead><tr><Th>Check</Th><Th>Dashboard</Th><Th>Compared</Th><Th>Difference</Th></tr></thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.label} className="align-top">
            <Td>{l.label}{l.note && <div className="text-[11px] text-ink-soft">{l.note}</div>}</Td>
            <Td className="num">{formatCents(l.expectedCents)}</Td>
            <Td className="num">{formatCents(l.actualCents)}</Td>
            <Td className="num whitespace-nowrap">
              {l.diffCents === 0 ? <span className="inline-flex items-center gap-1 rounded bg-paid px-1.5 text-paid-ink"><CheckCircle2 className="size-3" />Match</span>
                : <span className="rounded bg-pending px-1.5 text-pending-ink">{signed(l.diffCents ?? 0)}</span>}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

export default function ImportSync() {
  const { uid, payments, meta, settings } = useData()
  const sheets = useSheetsSync()
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<{ text: string; result: ParseResult } | null>(null)
  const [res, setRes] = useState<{ key: string; map: Record<number, string> }>({ key: '', map: {} })
  const [busy, setBusy] = useState(false)
  const pasteRef = useRef<HTMLTextAreaElement>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [done, setDone] = useState<null | {
    title: string
    lines: string[]
    before: number
    after: number
    sheet: { ok: boolean; text: string } | null
  }>(null)

  // Parse automatically (debounced). Saving is disabled until the parse matches the current text.
  useEffect(() => {
    if (!text.trim()) { setParsed(null); return }
    const t = setTimeout(() => setParsed({ text, result: parseDashboardText(text, { now: new Date() }) }), 250)
    return () => clearTimeout(t)
  }, [text])
  const ready = !!parsed && parsed.text === text
  const result = parsed?.result ?? null

  // Plan against the live Firestore data; the revision guards against races.
  const plan = useMemo(
    () => (result && (result.payments.length || result.summary.lifetimeCents !== null) ? planImport(payments, result, settings, meta.revision) : null),
    [result, payments, settings, meta.revision],
  )
  // Resolutions belong to one exact snapshot + plan; reset when either changes.
  const planKey = plan ? `${plan.snapshotKey}@${plan.baseRevision}` : ''
  const resolutions = useMemo(() => (res.key === planKey ? res.map : {}), [res, planKey])
  const setResolution = (idx: number, v: string) => setRes({ key: planKey, map: { ...resolutions, [idx]: v } })

  const by = (k: PlanItem['kind']) => plan?.items.filter((i) => i.kind === k) ?? []
  const review = [...by('conflict'), ...by('ambiguous')]
  const validation = plan ? validateResolutions(plan, resolutions) : null

  const view = useMemo(() => {
    if (!plan || !result) return null
    const before = lifetimeTotals(payments)
    const final = finalState(payments, plan, resolutions)
    const after = lifetimeTotals(final)
    const recon = reconcile(result, payments, plan, resolutions)
    const mc = metaChanges(meta.summary, meta.projects, result)
    // Real payment writes after the user's decisions (a "keep saved values" choice writes nothing)
    const probe = applyPlan(plan, resolutions, 0, 'probe')
    const unresolved = plan.items.some((i) => (i.kind === 'conflict' || i.kind === 'ambiguous') && !resolutions[i.idx])
    const paymentChanges = probe.creates.length > 0 || probe.updates.length > 0 || unresolved
    const projectMap = { ...(meta.projectMap ?? {}), ...inferProjectMap(result.projects, final) }
    return { before, after, recon, mc, paymentChanges, projectMap, finalCount: final.length }
  }, [plan, result, payments, resolutions, meta.summary, meta.projects, meta.projectMap])

  // Never save a partial or summary-only sync from a paste whose payment rows were not all read.
  const blocker = !result
    ? null
    : result.unparsedLines.length > 0
      ? `${result.unparsedLines.length === 1 ? 'One payment needs' : `${result.unparsedLines.length} payments need`} attention. Review the highlighted ${result.unparsedLines.length === 1 ? 'row' : 'rows'} above before saving. No payments have been changed.`
      : result.payments.length === 0
        ? "We couldn't find any earnings records. Copy the complete earnings page and try again. Your saved records are unchanged."
        : null

  const nothingToDo = !!view && !view.paymentChanges && !view.mc.summaryChanged && view.mc.projectChanges.length === 0 && JSON.stringify(view.projectMap) === JSON.stringify(meta.projectMap ?? {})
  const metaOnly = !!view && !view.paymentChanges && !nothingToDo

  const commit = async () => {
    if (!plan || !result || !ready || !view || blocker) return
    setBusy(true)
    setMsg(null)
    // Ask Google for Sheets access now, while we are still inside the click (popup rules).
    const sheetsReady = sheets.auto ? await sheets.ensureAccess() : false
    try {
      const r = await commitImportEx(firestoreDb, {
        uid, plan, resolutions, summary: result.summary, projects: result.projects,
        totals: { before: view.before.totalCents, after: view.after.totalCents },
        projectMap: view.projectMap,
      })
      // Firestore is saved; now refresh the Google Sheet reporting copy (never blocks the save).
      let sheet: { ok: boolean; text: string } | null = null
      if (sheets.auto && !r.noop) {
        if (!sheetsReady) sheet = { ok: false, text: 'Earnings saved. Spreadsheet not updated — reconnect Google Sheets to update your report.' }
        else {
          const ids = r.record?.createdIds ?? []
          const final = finalState(payments, plan, resolutions).map((p) => (p.id.startsWith('new-') ? { ...p, id: ids[Number(p.id.slice(4))] ?? p.id } : p))
          const projects = result.projects.length && !isStaleProjects(meta.projects, result.projects) ? result.projects : meta.projects
          try {
            markSheetSynced(meta.revision + 1)
            await sheets.sync({ payments: final, projects })
            sheet = { ok: true, text: 'Spreadsheet updated' }
          } catch (e) {
            sheet = { ok: false, text: `Earnings saved. Spreadsheet not updated. ${(e as Error).message}` }
          }
        }
      }
      const lines: string[] = []
      if (r.metaOnly) lines.push('Dashboard totals and project earnings refreshed (no payment changes)')
      else if (r.record) {
        const c = r.record.counts
        if (c.created) lines.push(`${c.created} new payment${c.created === 1 ? '' : 's'} added`)
        if (c.updated) lines.push(`${c.updated} payment${c.updated === 1 ? '' : 's'} updated`)
        if (c.unchanged) lines.push(`${c.unchanged} unchanged`)
        if (plan.preserved) lines.push(`${plan.preserved} older payment${plan.preserved === 1 ? '' : 's'} kept`)
        if (c.skipped) lines.push(`${c.skipped} kept as you saved ${c.skipped === 1 ? 'it' : 'them'}`)
      }
      setDone({
        title: r.noop ? "You're already up to date" : 'Earnings saved',
        lines,
        before: view.before.totalCents,
        after: view.after.totalCents,
        sheet,
      })
      setText('')
      setParsed(null)
      setShowAll(false)
    } catch (e) {
      setMsg({
        kind: 'err',
        text: e instanceof ConflictError
          ? 'Your records changed since this preview was created, so nothing was saved. The preview has been refreshed — review it and save again.'
          : `We couldn't confirm your changes were saved. Your pasted text is still here. The review below now reflects your latest saved records — if it says you're already up to date, the save went through; otherwise save again (it never creates duplicates). (${friendlyError(e)})`,
      })
    } finally {
      setBusy(false)
    }
  }

  const pasteFromClipboard = async () => {
    try { setText(await navigator.clipboard.readText()); setMsg(null); setDone(null) } catch {
      setMsg({ kind: 'info', text: "We couldn't access your clipboard. Paste the earnings page directly into the box instead (⌘/Ctrl+V)." })
      pasteRef.current?.focus()
    }
  }

  const changed = [...by('new'), ...by('update')]
  const reconWarn = view?.recon.filter((l) => l.diffCents !== 0) ?? []

  const step = done ? 3 : ready && plan ? 2 : 1

  if (done) {
    const delta = done.after - done.before
    return (
      <>
        <PageHeader title="Import earnings" subtitle="Paste once — ChaChing finds what changed." />
        <Stepper step={3} />
        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paid"><CheckCircle2 className="size-5 text-paid-ink" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-ink">{done.title}</h2>
              {done.title.startsWith("You're") ? (
                <p className="text-sm text-ink-soft">No changes were needed.</p>
              ) : (
                <p className="num text-sm text-ink-soft">
                  Earnings {formatCents(done.before)} → <b className="text-ink">{formatCents(done.after)}</b>
                  {delta !== 0 && <span className={delta > 0 ? 'text-paid-ink' : 'text-danger'}> ({signed(delta)})</span>}
                </p>
              )}
            </div>
          </div>
          {done.lines.length > 0 && (
            <ul className="mt-4 grid gap-1.5 text-sm sm:grid-cols-2">
              {done.lines.map((l) => <li key={l} className="flex items-center gap-2"><span aria-hidden className="size-1.5 rounded-full bg-ink-faint" />{l}</li>)}
            </ul>
          )}
          <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
            {!done.title.startsWith("You're") && <div className="flex items-center gap-2 text-paid-ink"><CheckCircle2 className="size-4" /> Saved to your cloud</div>}
            {done.sheet && (
              <div className={cn('flex items-start gap-2', done.sheet.ok ? 'text-paid-ink' : 'text-pending-ink')}>
                {done.sheet.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
                <span>{done.sheet.text}{!done.sheet.ok && <> · <Link to="/spreadsheets" className="underline">Open Spreadsheets</Link></>}</span>
              </div>
            )}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild variant="accent"><Link to="/">Back to Overview</Link></Button>
            <Link to="/activity" className="self-center px-2 text-sm text-ink-soft underline-offset-2 hover:text-ink hover:underline">View activity</Link>
          </div>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Import earnings" subtitle="Copy your complete earnings dashboard (⌘/Ctrl+A, ⌘/Ctrl+C) and paste it below. ChaChing finds what changed — paste as often as you like." />
      <Stepper step={step} />
      {msg && (
        <div className={cn('mb-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm', msg.kind === 'ok' ? 'bg-paid text-paid-ink' : msg.kind === 'info' ? 'bg-support text-ink' : 'bg-danger/10 text-danger')} role="alert">
          {msg.kind === 'err' ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
          <span className="flex-1">{msg.text}</span>
        </div>
      )}
      <Card>
        <CardContent className="pt-4">
          <Textarea ref={pasteRef} aria-label="Earnings page text" rows={step === 1 ? 9 : 4} value={text} onChange={(e) => { setText(e.target.value); if (msg?.kind !== 'err') setMsg(null) }} placeholder="Paste your earnings dashboard here…" className="font-mono text-xs" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={pasteFromClipboard}><ClipboardPaste /> Paste from clipboard</Button>
            {text && <Button variant="ghost" size="sm" onClick={() => setText('')}>Clear</Button>}
            {text && !ready && <span className="text-xs text-ink-soft">Analyzing…</span>}
            {ready && result && result.payments.length > 0 && <span className="text-xs text-ink-soft">Found {result.payments.length} payments{result.projects.length ? ` and ${result.projects.length} projects` : ''}</span>}
            <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-faint"><ShieldCheck className="size-3.5" /> Your financial data stays private</span>
          </div>
        </CardContent>
      </Card>

      {ready && result && !plan && (
        <div className="mt-4 rounded-xl bg-pending/70 px-4 py-3 text-sm text-pending-ink" role="alert">
          <div className="font-semibold">We couldn't find any earnings records.</div>
          Copy the complete earnings page and try again. Your saved records are unchanged.
        </div>
      )}

      {ready && result && (
        <div className="mt-4 space-y-4">
          {(result.warnings.length > 0) && (
            <div className="rounded-lg bg-pending/60 px-3 py-2 text-sm text-pending-ink">
              {result.warnings.map((w) => <div key={w} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{w}</div>)}
              {result.unparsedLines.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">{result.unparsedLines.slice(0, 10).map((l, i) => <li key={i} className="font-mono">{l}</li>)}</ul>
              )}
            </div>
          )}

          {plan && view && (
            <Card>
              <CardHeader>
                <CardTitle>Review changes</CardTitle>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge tone="paid">{by('new').length} new</Badge>
                  <Badge tone="hourly">{by('update').length} updated</Badge>
                  <Badge tone="neutral">{by('unchanged').length} unchanged</Badge>
                  {review.length > 0 && <Badge tone="pending">{review.length} to review</Badge>}
                  <Badge tone="neutral">{plan.preserved} saved, not on page (kept)</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <StatCard tone="total" label="Tracked total" value={formatCents(view.after.totalCents)} sub={signed(view.after.totalCents - view.before.totalCents) + ' vs saved'} />
                  <StatCard tone="paid" label="Paid" value={formatCents(view.after.paidCents)} sub={signed(view.after.paidCents - view.before.paidCents)} />
                  <StatCard tone="pending" label="Pending" value={formatCents(view.after.pendingCents)} sub={signed(view.after.pendingCents - view.before.pendingCents)} />
                  <StatCard tone="hourly" label="Hours" value={view.after.hours.toFixed(2)} sub={signedH(view.after.hours - view.before.hours)} />
                  <StatCard tone="incentive" label="Incentives & trials" value={formatCents(view.after.incentiveCents + view.after.trialCents)} />
                  <StatCard tone="support" label="Saved payments" value={String(view.after.count + payments.filter((p) => p.status === 'failed').length)} sub={`${payments.length} before`} />
                </div>

                {review.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-pending-ink/30">
                    <div className="bg-pending px-2.5 py-1.5 text-sm font-semibold text-pending-ink">Needs your decision ({review.length})</div>
                    {review.map((it) => (
                      <ChangeRow
                        key={it.idx}
                        it={it}
                        choice={
                          <>
                          <div className="mb-1 text-xs text-pending-ink">{it.kind === 'conflict' ? 'This snapshot may be older than your saved records. Keep your saved values or confirm the correction.' : 'More than one saved payment could match this entry. Choose the correct payment.'}</div>
                          <Select aria-label="Decision" className="h-8 max-w-xl text-xs" value={resolutions[it.idx] ?? ''} onChange={(e) => setResolution(it.idx, e.target.value)}>
                            <option value="">Choose…</option>
                            {it.kind === 'conflict' ? (
                              <>
                                <option value={it.existing!.id}>Apply this change (it is a real correction)</option>
                                <option value="skip">Keep my saved values (pasted page is older)</option>
                              </>
                            ) : (
                              <>
                                {it.candidates.map((c) => (
                                  <option key={c.id} value={c.id}>Update saved {formatCents(c.earningsCents)} · {formatRange(c.workStart, c.workEnd)} · {STATUS_LABEL[c.status]}</option>
                                ))}
                                <option value="new">Add as a new payment</option>
                                <option value="skip">Skip this row</option>
                              </>
                            )}
                          </Select>
                          </>
                        }
                      />
                    ))}
                  </div>
                )}

                {changed.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-line">
                    <div className="bg-thead px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide">Changes to save</div>
                    {changed.map((it) => <ChangeRow key={it.idx} it={it} />)}
                  </div>
                )}

                {view.mc.projectChanges.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-line">
                    <div className="bg-thead px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide">Project totals</div>
                    {view.mc.projectChanges.map((c) => (
                      <div key={c.name} className="flex flex-wrap items-center gap-2 border-t border-line px-2.5 py-1.5 text-[13px] first:border-t-0">
                        <span className="flex-1 font-medium">{c.name}{c.from === null && <Badge tone="title" className="ml-1">New</Badge>}</span>
                        <span className="rounded bg-total px-1.5 text-xs">{c.from === null ? '' : `${formatCents(c.from)} → `}<b>{formatCents(c.to)}</b>{c.from !== null && c.to !== null && <span className="text-paid-ink"> ({signed(c.to - c.from)})</span>}</span>
                        {c.activeFrom !== c.activeTo && c.activeTo !== null && <Badge tone={c.activeTo ? 'paid' : 'neutral'}>{c.activeTo ? 'Active' : 'Inactive'}</Badge>}
                      </div>
                    ))}
                  </div>
                )}

                {(view.mc.staleSummary || view.mc.staleProjects) && (
                  <div className="mt-3 rounded-lg bg-pending/50 px-3 py-2 text-xs text-pending-ink">
                    <div className="flex items-center gap-1.5 font-semibold"><Info className="size-3.5" /> This snapshot may be older than your saved records</div>
                    {view.mc.staleSummary && <div>• Its dashboard total ({formatCents(result.summary.lifetimeCents)}) is lower than the saved one ({formatCents(meta.summary?.lifetimeCents ?? null)}), so your saved dashboard totals are kept.</div>}
                    {view.mc.staleProjects && <div>• Some project totals are lower than the saved ones, so the saved project totals are kept.</div>}
                  </div>
                )}

                {reconWarn.length > 0 && !view.mc.staleSummary && (
                  <div className="mt-3 rounded-lg bg-pending/50 px-3 py-2 text-xs text-pending-ink">
                    <div className="flex items-center gap-1.5 font-semibold"><Info className="size-3.5" /> Totals differ (not blocking)</div>
                    {reconWarn.map((l) => <div key={l.label}>• {l.label}: {signed(l.diffCents ?? 0)}. {l.note}</div>)}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {blocker && <div className="w-full rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert"><AlertTriangle className="mr-1 inline size-4" />{blocker}</div>}
                  {nothingToDo && !blocker ? (
                    <div className="flex w-full flex-wrap items-center gap-3 rounded-xl bg-paid/70 px-4 py-3 text-sm text-paid-ink" role="status">
                      <CheckCircle2 className="size-5" />
                      <span className="flex-1"><b>You're already up to date.</b> No changes were needed.</span>
                      <Link to="/" className="font-medium underline">Back to Overview</Link>
                    </div>
                  ) : (
                    <Button variant="accent" size="lg" onClick={commit} disabled={busy || !ready || !!validation || !!blocker}>
                      <Upload /> {busy ? 'Saving…' : metaOnly ? 'Save dashboard totals' : 'Save changes'}
                    </Button>
                  )}
                  {validation && <span className="text-sm text-pending-ink">{validation}</span>}
                  {busy && <span className="text-sm text-ink-soft" role="status">Saving your changes…</span>}
                  <button className="text-xs text-ink-soft underline" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Hide' : 'Show'} all rows & checks</button>
                </div>

                {showAll && (
                  <div className="mt-3 space-y-3">
                    <Table>
                      <thead><tr><Th>Result</Th><Th>Work period</Th><Th>Contract</Th><Th>Type</Th><Th>Hours</Th><Th>Earned</Th><Th>Status</Th><Th>Payout</Th><Th>Release</Th></tr></thead>
                      <tbody>
                        {plan.items.map((it) => (
                          <tr key={it.idx}>
                            <Td><Badge tone={it.kind === 'new' ? 'paid' : it.kind === 'update' ? 'hourly' : it.kind === 'unchanged' ? 'neutral' : 'pending'}>{it.kind}</Badge></Td>
                            <Td className="whitespace-nowrap">{formatRange(it.incoming.workStart, it.incoming.workEnd)}</Td>
                            <Td>{it.existing?.contract ?? it.incoming.contract}</Td>
                            <Td><TypeBadge type={it.incoming.type} /></Td>
                            <Td className="num">{it.incoming.hours?.toFixed(2) ?? '—'}</Td>
                            <Td className="num font-semibold">{formatCents(it.incoming.earningsCents)}</Td>
                            <Td><StatusBadge status={it.incoming.status} label={it.incoming.statusLabel} /></Td>
                            <Td className="whitespace-nowrap">{formatDate(it.incoming.payoutDate)}</Td>
                            <Td className="text-xs text-ink-soft">{it.incoming.releaseText ?? formatDate(it.incoming.releaseDate)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                    {view.recon.length ? <Reconciliation lines={view.recon} /> : <Empty>Copy the whole page (including "Total earnings to date") to reconcile with the dashboard total.</Empty>}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

    </>
  )
}

function Stepper({ step }: { step: 1 | 2 | 3 | number }) {
  const steps = ['Paste', 'Review', 'Done']
  return (
    <ol className="mb-3 flex items-center gap-2 text-xs" aria-label="Import progress">
      {steps.map((label, i) => {
        const n = i + 1
        const state = n < step ? 'done' : n === step ? 'current' : 'todo'
        return (
          <li key={label} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span className={cn('flex size-6 items-center justify-center rounded-full text-[11px] font-semibold', state === 'done' ? 'bg-paid text-paid-ink' : state === 'current' ? 'bg-accent text-white' : 'bg-support text-ink-soft')}>
              {state === 'done' ? '✓' : n}
            </span>
            <span className={cn(state === 'current' ? 'font-semibold text-ink' : 'text-ink-soft')}>{label}</span>
            {n < steps.length && <span aria-hidden className="h-px w-6 bg-line sm:w-10" />}
          </li>
        )
      })}
    </ol>
  )
}
