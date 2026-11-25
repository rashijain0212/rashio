import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardPaste, History, Info, RotateCcw, Upload } from 'lucide-react'
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
import { commitImportEx, ConflictError, EditedSinceImportError, undoImport } from '@/lib/store'
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
  const { uid, payments, meta, settings, imports } = useData()
  const sheets = useSheetsSync()
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<{ text: string; result: ParseResult } | null>(null)
  const [res, setRes] = useState<{ key: string; map: Record<number, string> }>({ key: '', map: {} })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [showAll, setShowAll] = useState(false)

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
      ? `${result.unparsedLines.length} payment row(s) could not be read, so nothing will be saved (a partial sync could leave your totals wrong). Please copy the whole Earnings page again; if it keeps happening, send the unreadable lines shown above.`
      : result.payments.length === 0
        ? 'No payment rows were recognised in this paste, so nothing will be saved. Copy the entire earnings page (⌘/Ctrl+A) including the payments table.'
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
      let sheetNote = ''
      if (sheets.auto && !r.noop) {
        if (!sheetsReady) sheetNote = ' Google Sheet not updated (not connected) — use Settings → Sync now.'
        else {
          const ids = r.record?.createdIds ?? []
          const final = finalState(payments, plan, resolutions).map((p) => (p.id.startsWith('new-') ? { ...p, id: ids[Number(p.id.slice(4))] ?? p.id } : p))
          const projects = result.projects.length && !isStaleProjects(meta.projects, result.projects) ? result.projects : meta.projects
          try {
            markSheetSynced(meta.revision + 1)
            sheetNote = ` ${await sheets.sync({ payments: final, projects })}`
          } catch (e) {
            sheetNote = ` ${(e as Error).message}`
          }
        }
      }
      if (r.noop) setMsg({ kind: 'info', text: 'Already up to date — nothing needed saving.' })
      else if (r.metaOnly) setMsg({ kind: 'ok', text: `Saved to the cloud: dashboard summary and project totals updated (no payment changes).${sheetNote}` })
      else {
        const c = r.record!.counts
        const delta = view.after.totalCents - view.before.totalCents
        setMsg({
          kind: 'ok',
          text: `Saved to the cloud: ${c.created} new, ${c.updated} updated, ${c.unchanged} unchanged, ${plan.preserved} older payments retained${c.skipped ? `, ${c.skipped} kept as saved` : ''} — ${view.finalCount} payments in total. Tracked earnings ${formatCents(view.before.totalCents)} → ${formatCents(view.after.totalCents)} (${signed(delta)}).${sheetNote}`,
        })
      }
      setText('')
      setParsed(null)
      setShowAll(false)
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ConflictError ? e.message : `Nothing was saved. ${friendlyError(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const undo = async (id: string) => {
    if (!window.confirm('Undo this import? Payments it created are removed and payments it changed are restored.')) return
    try {
      const r = await undoImport(firestoreDb, uid, id)
      setMsg({ kind: 'ok', text: `Undone: ${r.deleted} removed, ${r.restored} restored.` })
    } catch (e) {
      if (e instanceof EditedSinceImportError && window.confirm(e.message)) {
        const r = await undoImport(firestoreDb, uid, id, true)
        setMsg({ kind: 'ok', text: `Undone: ${r.deleted} removed, ${r.restored} restored.` })
      } else if (!(e instanceof EditedSinceImportError)) setMsg({ kind: 'err', text: `Undo failed — nothing was changed. ${friendlyError(e)}` })
    }
  }

  const pasteFromClipboard = async () => {
    try { setText(await navigator.clipboard.readText()); setMsg(null) } catch { setMsg({ kind: 'err', text: 'Clipboard access was blocked — paste with ⌘/Ctrl+V instead.' }) }
  }

  const changed = [...by('new'), ...by('update')]
  const reconWarn = view?.recon.filter((l) => l.diffCents !== 0) ?? []

  return (
    <>
      <PageHeader title="Import & Sync" subtitle="On your earnings dashboard press ⌘/Ctrl+A, then ⌘/Ctrl+C, and paste here. Paste as often as you like — only real changes are saved." />
      {msg && (
        <div className={cn('mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm', msg.kind === 'ok' ? 'bg-paid text-paid-ink' : msg.kind === 'info' ? 'bg-support text-ink' : 'bg-danger/10 text-danger')} role="status">
          {msg.kind === 'err' ? <AlertTriangle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}
          <span className="flex-1">{msg.text}</span>
          {msg.kind === 'ok' && <Link to="/" className="font-medium underline">View dashboard</Link>}
        </div>
      )}
      <Card>
        <CardContent className="pt-4">
          <Textarea aria-label="Earnings page text" rows={8} value={text} onChange={(e) => { setText(e.target.value); if (msg?.kind !== 'err') setMsg(null) }} placeholder="Paste the full earnings page here…" className="font-mono text-xs" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={pasteFromClipboard}><ClipboardPaste /> Paste from clipboard</Button>
            {text && <Button variant="ghost" size="sm" onClick={() => setText('')}>Clear</Button>}
            {text && !ready && <span className="text-xs text-ink-soft">Analyzing…</span>}
            {ready && result && <span className="text-xs text-ink-soft">{result.payments.length} payment rows · {result.projects.length} projects recognised</span>}
          </div>
        </CardContent>
      </Card>

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
                <CardTitle>Sync preview</CardTitle>
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
                    <div className="flex items-center gap-1.5 font-semibold"><Info className="size-3.5" /> This page looks older than your saved data</div>
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
                  <Button variant="accent" size="lg" onClick={commit} disabled={busy || !ready || !!validation || nothingToDo || !!blocker}>
                    <Upload /> {busy ? 'Saving to cloud…' : nothingToDo ? 'Already up to date' : metaOnly ? 'Save dashboard update' : 'Sync to cloud'}
                  </Button>
                  {validation && <span className="text-sm text-pending-ink">{validation}</span>}
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

      <Card className="mt-4">
        <CardHeader><CardTitle className="flex items-center gap-1.5"><History className="size-4" />Import history</CardTitle><span className="text-xs text-ink-soft">Last sync {meta.lastSyncAt ? new Date(meta.lastSyncAt).toLocaleString() : 'never'}</span></CardHeader>
        <CardContent>
          {imports.length ? (
            <Table>
              <thead><tr><Th>When</Th><Th className="hidden sm:table-cell">New</Th><Th className="hidden sm:table-cell">Updated</Th><Th>Change</Th><Th className="hidden sm:table-cell">dashboard total</Th><Th /></tr></thead>
              <tbody>
                {imports.map((r) => (
                  <tr key={r.id} className={r.undone ? 'text-ink-faint line-through' : ''}>
                    <Td className="whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      <div className="text-[11px] text-ink-soft sm:hidden">{r.counts.created} new · {r.counts.updated} updated</div>
                    </Td>
                    <Td className="num hidden sm:table-cell">{r.counts.created}</Td>
                    <Td className="num hidden sm:table-cell">{r.counts.updated}</Td>
                    <Td className="num whitespace-nowrap">{r.totalAfterCents !== undefined && r.totalBeforeCents !== undefined ? signed(r.totalAfterCents - r.totalBeforeCents) : '—'}</Td>
                    <Td className="num hidden sm:table-cell">{formatCents(r.summary?.lifetimeCents ?? null)}</Td>
                    <Td className="py-0.5 text-right">
                      {r.undone ? <span className="text-xs no-underline">undone</span> : (
                        <Button variant="ghost" size="sm" onClick={() => undo(r.id)} disabled={!r.counts.created && !r.counts.updated} aria-label="Undo this import"><RotateCcw /><span className="hidden sm:inline">Undo</span></Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty>No imports yet.</Empty>}
        </CardContent>
      </Card>
    </>
  )
}
