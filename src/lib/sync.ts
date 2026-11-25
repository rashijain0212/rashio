// Incremental synchronisation: match parsed dashboard rows against stored payments.
// Identity never depends on row position, amount, hours or display order.
// The pasted page is an incremental update: nothing missing from it is deleted.

import type { ParsedPayment, ParseResult, ParsedProject, ParsedSummary, Payment, ReconciliationLine, Settings } from './types'
import { contractRates, inferRate, normalizeName } from './rates'
import { toDayNumber } from './dates'

export type FieldName =
  | 'hours'
  | 'earningsCents'
  | 'status'
  | 'statusLabel'
  | 'releaseDate'
  | 'releaseKind'
  | 'payoutDate'
  | 'rateCents'
  | 'typeLabel'

export interface FieldChange {
  field: FieldName
  from: unknown
  to: unknown
}

/**
 * new / update / unchanged: decided automatically.
 * ambiguous: several stored payments could match; user picks.
 * conflict: a unique match whose change looks stale (lower earnings/hours,
 *           Paid → Upcoming); user confirms or keeps the saved values.
 */
export type PlanKind = 'new' | 'update' | 'unchanged' | 'ambiguous' | 'conflict'

export interface PlanItem {
  idx: number
  kind: PlanKind
  incoming: ParsedPayment
  existing?: Payment
  changes: FieldChange[]
  candidates: Payment[]
  suggestion?: string
  reason?: string
  fuzzy?: boolean
  /** Original Dashboard contract name when mapped to a stored name */
  alias?: { from: string; to: string }
  /** Contract not seen before */
  newContract?: boolean
}

export interface ImportPlan {
  items: PlanItem[]
  preserved: number
  baseRevision: number
  /** Fingerprint of the parsed snapshot; resolutions are tied to it */
  snapshotKey: string
  reconciliation: ReconciliationLine[]
}

/** Resolution for ambiguous/conflict items: existing payment id (apply), 'new', or 'skip' (keep saved) */
export type Resolution = string

// ---------------------------------------------------------------- identity

/** Normalise names: case, punctuation, whitespace, Unicode dashes. */
export function normName(s: string): string {
  return normalizeName(s.normalize('NFKC').replace(/[‐-―−]/g, '-'))
}

export function identityKey(p: {
  contract: string
  type: string
  workStart: string | null
  workEnd: string | null
  payoutDate: string | null
}): string {
  const period = p.workStart || p.workEnd ? `${p.workStart ?? ''}..${p.workEnd ?? ''}` : `payout:${p.payoutDate ?? ''}`
  return `${normName(p.contract)}|${p.type}|${period}`
}

/** Key used for rows without a work period (incentives): contract + type + payout date. */
function payoutKey(p: { contract: string; type: string; payoutDate: string | null }): string {
  return `${normName(p.contract)}|${p.type}|payout:${p.payoutDate ?? ''}`
}

/**
 * Map a Dashboard contract name to the name already used in stored records:
 * exact (normalised) match → configured alias → unique stored name contained
 * as whole words in the dashboard's name (e.g. "Acme Engineers
 * (Agent Work Experience)" → "Agent Work").
 */
export function resolveContract(name: string, storedNames: string[], aliases: Record<string, string> = {}): string {
  const n = normName(name)
  const exact = storedNames.find((s) => normName(s) === n)
  if (exact) return exact
  for (const [from, to] of Object.entries(aliases)) {
    if (normName(from) === n) return storedNames.find((s) => normName(s) === normName(to)) ?? to
  }
  const contained = [...new Set(storedNames)].filter((s) => {
    const k = normName(s)
    if (k.length < 6 || !k.includes(' ')) return false
    return ` ${n} `.includes(` ${k} `)
  })
  return contained.length === 1 ? contained[0] : name
}

function overlaps(a: Pick<Payment, 'workStart' | 'workEnd'>, b: Pick<Payment, 'workStart' | 'workEnd'>): boolean {
  if (!a.workStart || !b.workStart) return false
  const a0 = toDayNumber(a.workStart)
  const a1 = toDayNumber(a.workEnd ?? a.workStart)
  const b0 = toDayNumber(b.workStart)
  const b1 = toDayNumber(b.workEnd ?? b.workStart)
  return a0 <= b1 && b0 <= a1
}

export function withRate(p: ParsedPayment, settings: Settings, rates: Map<string, number>): ParsedPayment {
  const r = inferRate({
    type: p.type,
    earningsCents: p.earningsCents,
    hours: p.hours,
    explicitRateCents: p.rateCents,
    preferredRates: settings.hourlyRates,
    tolerancePct: settings.rateTolerancePct,
    contractRateCents: rates.get(normalizeName(p.contract)) ?? null,
  })
  return { ...p, rateCents: r.rateCents }
}

// ---------------------------------------------------------------- diffing

const STATUS_RANK: Record<string, number> = { other: 0, failed: 0, pending: 1, processing: 2, paid: 3 }

/** Only dashboard-owned fields are compared; work dates, allocations, notes and corrected rates stay as stored. */
export function diff(existing: Payment, inc: ParsedPayment): FieldChange[] {
  const out: FieldChange[] = []
  const cmp = (field: FieldName, a: unknown, b: unknown) => {
    if ((a ?? null) !== (b ?? null)) out.push({ field, from: a ?? null, to: b ?? null })
  }
  cmp('earningsCents', existing.earningsCents, inc.earningsCents)
  if (inc.hours !== null) cmp('hours', existing.hours, inc.hours)
  if (inc.status !== 'other') cmp('status', existing.status, inc.status)
  if (inc.releaseDate) {
    cmp('releaseDate', existing.releaseDate, inc.releaseDate)
    if (inc.releaseKind) cmp('releaseKind', existing.releaseKind ?? null, inc.releaseKind)
  }
  if (inc.payoutDate) cmp('payoutDate', existing.payoutDate, inc.payoutDate)
  if (inc.rateCents !== null && !existing.rateCents) cmp('rateCents', existing.rateCents, inc.rateCents)
  return out
}

/** Why a change looks like it comes from an older snapshot, or null. */
export function staleReason(existing: Payment, changes: FieldChange[]): string | null {
  const reasons: string[] = []
  for (const c of changes) {
    if (c.field === 'earningsCents' && (c.to as number) < (c.from as number)) reasons.push('earnings would decrease')
    if (c.field === 'hours' && c.from !== null && (c.to as number) < (c.from as number)) reasons.push('hours would decrease')
    if (c.field === 'status' && STATUS_RANK[c.to as string] < STATUS_RANK[c.from as string]) {
      reasons.push(`status would go back from ${c.from} to ${c.to}`)
    }
    if (c.field === 'releaseKind' && c.from === 'actual' && c.to === 'expected') reasons.push('a completed release would become expected again')
  }
  void existing
  return reasons.length ? `Possibly an older snapshot: ${reasons.join(', ')}.` : null
}

// ---------------------------------------------------------------- planning

export function snapshotKey(parsed: ParseResult): string {
  // djb2 over the normalised rows + summary; ties resolutions to this exact paste.
  const s = JSON.stringify([parsed.payments.map((p) => p.raw), parsed.summary.lifetimeCents, parsed.projects])
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${parsed.payments.length}:${(h >>> 0).toString(36)}`
}

export function planImport(
  existingAll: Payment[],
  parsed: ParseResult,
  settings: Settings,
  baseRevision: number,
): ImportPlan {
  const storedNames = existingAll.map((e) => e.contract)
  const aliased = parsed.payments.map((p) => {
    const c = resolveContract(p.contract, storedNames, settings.contractAliases)
    return c === p.contract ? p : { ...p, contract: c, sourceContract: p.contract }
  })
  // Two passes so 0-hour rows can borrow the rate inferred from this same paste.
  const firstPass = aliased.map((p) => withRate(p, settings, contractRates(existingAll)))
  const rates = contractRates([...existingAll, ...firstPass])
  const incoming = aliased.map((p) => withRate(p, settings, rates))
  const knownContracts = new Set(storedNames.map(normName))
  const used = new Set<string>()
  const result: (PlanItem | null)[] = incoming.map(() => null)

  const mk = (i: number, kind: PlanKind, extra: Partial<PlanItem> = {}): PlanItem => {
    const inc = incoming[i]
    return {
      idx: i,
      kind,
      incoming: inc,
      changes: [],
      candidates: [],
      alias: inc.sourceContract ? { from: inc.sourceContract, to: inc.contract } : undefined,
      newContract: !knownContracts.has(normName(inc.contract)),
      ...extra,
    }
  }
  const match = (i: number, e: Payment, extra: Partial<PlanItem> = {}) => {
    used.add(e.id)
    const changes = diff(e, incoming[i])
    const stale = staleReason(e, changes)
    if (stale) {
      result[i] = mk(i, 'conflict', { existing: e, changes, candidates: [e], reason: stale, ...extra })
    } else {
      result[i] = mk(i, changes.length ? 'update' : 'unchanged', { existing: e, changes, ...extra })
    }
  }

  // Index stored payments. Non-hourly records with a hand-entered work date are
  // also indexed by payout date so dashboard rows without a period still find them.
  const exByKey = new Map<string, Payment[]>()
  const add = (k: string, e: Payment) => exByKey.set(k, [...(exByKey.get(k) ?? []), e])
  for (const e of existingAll) {
    add(identityKey(e), e)
    if (e.type !== 'hourly' && e.workStart && e.payoutDate) add(payoutKey(e), e)
  }
  const incByKey = new Map<string, number[]>()
  incoming.forEach((p, i) => {
    const k = identityKey(p)
    incByKey.set(k, [...(incByKey.get(k) ?? []), i])
  })

  // Pass 1: identity groups, matched as a multiset.
  for (const [key, idxs] of incByKey) {
    const ex = (exByKey.get(key) ?? []).filter((e) => !used.has(e.id))
    if (!ex.length) continue
    let remI = [...idxs]
    let remE = [...ex]
    // a) exact (payout date + amount) — handles identical twin incentives too
    for (const i of [...remI]) {
      const inc = incoming[i]
      const e = remE.find((x) => x.payoutDate === inc.payoutDate && x.earningsCents === inc.earningsCents) ??
        remE.find((x) => x.earningsCents === inc.earningsCents && x.type !== 'hourly')
      if (e) {
        match(i, e)
        remI = remI.filter((x) => x !== i)
        remE = remE.filter((x) => x.id !== e.id)
      }
    }
    if (!remI.length || !remE.length) continue
    // b) one-to-one leftover: same payment, values or payout date changed
    if (remI.length === 1 && remE.length === 1) {
      match(remI[0], remE[0], {
        reason: remE[0].payoutDate !== incoming[remI[0]].payoutDate ? 'Payout date changed' : undefined,
      })
      continue
    }
    // c) unique pairing by payout date
    const byDate = new Map<string, { i: number[]; e: Payment[] }>()
    for (const i of remI) {
      const d = incoming[i].payoutDate ?? ''
      byDate.set(d, { i: [...(byDate.get(d)?.i ?? []), i], e: byDate.get(d)?.e ?? [] })
    }
    for (const e of remE) {
      const d = e.payoutDate ?? ''
      byDate.set(d, { i: byDate.get(d)?.i ?? [], e: [...(byDate.get(d)?.e ?? []), e] })
    }
    const stillI: number[] = []
    const stillE: Payment[] = []
    for (const { i, e } of byDate.values()) {
      if (i.length === 1 && e.length === 1) match(i[0], e[0])
      else {
        stillI.push(...i)
        stillE.push(...e)
      }
    }
    // d) never guess between several candidates
    if (stillI.length && stillE.length) {
      for (const i of stillI) {
        const inc = incoming[i]
        const sorted = [...stillE].sort(
          (a, b) => Math.abs(a.earningsCents - inc.earningsCents) - Math.abs(b.earningsCents - inc.earningsCents),
        )
        result[i] = mk(i, 'ambiguous', {
          candidates: sorted,
          suggestion: sorted[0]?.id,
          reason: `${stillI.length} pasted vs ${stillE.length} saved payments share this contract, type and ${inc.workStart ? 'work period' : 'payout date'} and their amounts changed`,
        })
      }
      stillE.forEach((e) => used.add(e.id))
    }
  }

  // Pass 2: fuzzy (hand-split historical periods etc.)
  for (let i = 0; i < incoming.length; i++) {
    if (result[i]) continue
    const inc = incoming[i]
    const fuzzy = existingAll.filter(
      (e) =>
        !used.has(e.id) &&
        normName(e.contract) === normName(inc.contract) &&
        e.type === inc.type &&
        (overlaps(e, inc) || (!!inc.payoutDate && e.payoutDate === inc.payoutDate && !inc.workStart)),
    )
    if (!fuzzy.length) continue
    const exact = fuzzy.filter((e) => e.earningsCents === inc.earningsCents && e.payoutDate === inc.payoutDate)
    if (exact.length === 1) {
      match(i, exact[0], { fuzzy: true, reason: 'Matched by contract, type, overlapping dates and amount; stored work dates kept' })
      continue
    }
    result[i] = mk(i, 'ambiguous', {
      candidates: fuzzy,
      suggestion: 'new',
      fuzzy: true,
      reason: 'A saved payment for this contract overlaps these dates but does not match exactly',
    })
  }

  const items = incoming.map((_, i) => result[i] ?? mk(i, 'new'))
  const matchedIds = new Set(items.flatMap((it) => (it.existing ? [it.existing.id] : [])))
  const plan: ImportPlan = {
    items,
    preserved: existingAll.filter((e) => !matchedIds.has(e.id)).length,
    baseRevision,
    snapshotKey: snapshotKey(parsed),
    reconciliation: [],
  }
  plan.reconciliation = reconcile(parsed, existingAll, plan, {})
  return plan
}

/** Validate resolutions for ambiguous/conflict items. Returns an error message or null. */
export function validateResolutions(plan: ImportPlan, resolutions: Record<number, Resolution>): string | null {
  const seen = new Set<string>()
  for (const it of plan.items) if (it.existing && it.kind !== 'conflict') seen.add(it.existing.id)
  for (const it of plan.items.filter((x) => x.kind === 'ambiguous' || x.kind === 'conflict')) {
    const r = resolutions[it.idx]
    if (!r) return it.kind === 'conflict' ? 'Confirm or reject each flagged change before saving.' : 'Resolve every ambiguous match before importing.'
    if (r === 'skip') continue
    if (r === 'new') {
      if (it.kind === 'conflict') return 'Invalid choice.'
      continue
    }
    if (!it.candidates.some((c) => c.id === r)) return 'Invalid match selected.'
    if (seen.has(r)) return 'The same saved payment was chosen for more than one pasted row.'
    seen.add(r)
  }
  return null
}

export interface ApplyOutput {
  creates: Omit<Payment, 'id'>[]
  createIdx: number[]
  updates: { before: Payment; after: Payment }[]
  counts: { created: number; updated: number; unchanged: number; ambiguous: number; skipped: number }
}

export function applyPlan(
  plan: ImportPlan,
  resolutions: Record<number, Resolution>,
  now: number,
  importId: string,
): ApplyOutput {
  const creates: Omit<Payment, 'id'>[] = []
  const createIdx: number[] = []
  const updates: { before: Payment; after: Payment }[] = []
  const counts = { created: 0, updated: 0, unchanged: 0, ambiguous: 0, skipped: 0 }

  const toNew = (inc: ParsedPayment): Omit<Payment, 'id'> => ({
    contract: inc.contract,
    sourceContract: inc.sourceContract ?? null,
    type: inc.type,
    typeLabel: inc.typeLabel,
    workStart: inc.workStart,
    workEnd: inc.workEnd,
    payoutDate: inc.payoutDate,
    hours: inc.hours,
    earningsCents: inc.earningsCents,
    rateCents: inc.rateCents,
    rateInferred: inc.rateCents !== null,
    status: inc.status,
    statusLabel: inc.statusLabel,
    releaseDate: inc.releaseDate,
    releaseKind: inc.releaseKind,
    releaseText: inc.releaseText ?? null,
    source: 'import',
    createdAt: now,
    updatedAt: now,
    lastImportId: importId,
  })

  const applyChanges = (e: Payment, inc: ParsedPayment, changes: FieldChange[]): Payment => {
    const after: Payment = { ...e, updatedAt: now, lastImportId: importId }
    for (const c of changes) (after as unknown as Record<string, unknown>)[c.field] = c.to
    if (changes.some((c) => c.field === 'status')) after.statusLabel = inc.statusLabel
    if (inc.releaseText) after.releaseText = inc.releaseText
    if (inc.sourceContract && !e.sourceContract) after.sourceContract = inc.sourceContract
    return after
  }

  for (const it of plan.items) {
    if (it.kind === 'new') {
      creates.push(toNew(it.incoming))
      createIdx.push(it.idx)
      counts.created++
    } else if (it.kind === 'update' && it.existing) {
      updates.push({ before: it.existing, after: applyChanges(it.existing, it.incoming, it.changes) })
      counts.updated++
    } else if (it.kind === 'unchanged') {
      counts.unchanged++
    } else {
      counts.ambiguous++
      const r = resolutions[it.idx]
      if (!r || r === 'skip') {
        counts.skipped++
      } else if (r === 'new') {
        creates.push(toNew(it.incoming))
        createIdx.push(it.idx)
        counts.created++
      } else {
        const e = it.candidates.find((c) => c.id === r)
        if (e) {
          const changes = diff(e, it.incoming)
          if (changes.length) {
            updates.push({ before: e, after: applyChanges(e, it.incoming, changes) })
            counts.updated++
          } else counts.unchanged++
        }
      }
    }
  }
  return { creates, createIdx, updates, counts }
}

/** The payment set that would be stored after applying the plan. */
export function finalState(existing: Payment[], plan: ImportPlan, resolutions: Record<number, Resolution>): Payment[] {
  const out = applyPlan(plan, resolutions, 0, 'preview')
  const byId = new Map(existing.map((e) => [e.id, e]))
  for (const u of out.updates) byId.set(u.after.id, u.after)
  return [...byId.values(), ...out.creates.map((c, i) => ({ ...c, id: `new-${i}` }) as Payment)]
}

// ---------------------------------------------------------------- reconciliation

const sum = (ps: { earningsCents: number; status?: string }[]) =>
  ps.filter((p) => p.status !== 'failed').reduce((a, p) => a + p.earningsCents, 0)

/**
 * Non-blocking checks. The dashboard's sections refresh independently, so
 * each source total is kept separate and nothing is adjusted to force a match.
 */
export function reconcile(
  parsed: ParseResult,
  existing: Payment[],
  plan: ImportPlan,
  resolutions: Record<number, Resolution>,
): ReconciliationLine[] {
  const lines: ReconciliationLine[] = []
  const s = parsed.summary
  const after = sum(finalState(existing, plan, resolutions))
  if (s.lifetimeCents !== null) {
    lines.push({
      label: '"Total earnings to date" vs your tracked total after sync',
      expectedCents: s.lifetimeCents,
      actualCents: after,
      diffCents: after - s.lifetimeCents,
      note:
        after === s.lifetimeCents
          ? 'Every dollar The dashboard reports is accounted for.'
          : 'Often temporary (the dashboard sections refresh at different times) or caused by older payments not on this page.',
    })
  }
  if (s.chartTotalCents != null && s.lifetimeCents !== null) {
    lines.push({
      label: '"Earnings over time" chart vs dashboard total',
      expectedCents: s.lifetimeCents,
      actualCents: s.chartTotalCents,
      diffCents: s.chartTotalCents - s.lifetimeCents,
      note: 'Informational: the chart refreshes separately. Your records are not changed to match it.',
    })
  }
  if (parsed.projects.length && s.lifetimeCents !== null) {
    const proj = parsed.projects.reduce((a, p) => a + (p.earningsCents ?? 0), 0)
    lines.push({
      label: 'Sum of project totals vs dashboard total',
      expectedCents: s.lifetimeCents,
      actualCents: proj,
      diffCents: proj - s.lifetimeCents,
      note: proj === s.lifetimeCents ? undefined : 'Informational: project cards refresh separately.',
    })
  }
  return lines
}

// ---------------------------------------------------------------- summary/project changes

/** The dashboard's lifetime total only grows: a lower value means the pasted page is older. */
export function isStaleSummary(prev: ParsedSummary | null, next: ParsedSummary | null): boolean {
  return !!next && next.lifetimeCents !== null && prev?.lifetimeCents != null && next.lifetimeCents < prev.lifetimeCents
}

/** Project totals only grow: any decrease means the pasted project cards are older. */
export function isStaleProjects(prev: ParsedProject[], next: ParsedProject[]): boolean {
  const old = new Map(prev.map((p) => [normName(p.name), p.earningsCents ?? 0]))
  return next.some((p) => p.earningsCents !== null && (old.get(normName(p.name)) ?? -Infinity) > p.earningsCents)
}

export interface MetaChanges {
  /** The pasted summary/project cards are older than the saved ones and will be ignored */
  staleSummary: boolean
  staleProjects: boolean
  summaryChanged: boolean
  projectChanges: { name: string; from: number | null; to: number | null; activeFrom: boolean | null; activeTo: boolean | null }[]
}

export function metaChanges(
  prevSummary: ParsedSummary | null,
  prevProjects: ParsedProject[],
  parsed: ParseResult,
): MetaChanges {
  const strip = (s: ParsedSummary | null) => {
    if (!s) return null
    const rest: Record<string, unknown> = { ...s }
    delete rest.importedAt
    delete rest.missing
    return JSON.stringify(rest, Object.keys(rest).sort())
  }
  const staleSummary = isStaleSummary(prevSummary, parsed.summary)
  const staleProjects = isStaleProjects(prevProjects, parsed.projects)
  const hasSummary = !staleSummary && (parsed.summary.lifetimeCents !== null || parsed.summary.chartTotalCents != null)
  const merged = prevSummary ? { ...prevSummary, ...Object.fromEntries(Object.entries(parsed.summary).filter(([, v]) => v !== null && v !== undefined)) } : parsed.summary
  const summaryChanged = hasSummary && strip(prevSummary) !== strip(merged as ParsedSummary)
  const prev = new Map(prevProjects.map((p) => [normName(p.name), p]))
  const projectChanges = (staleProjects ? [] : parsed.projects)
    .map((p) => {
      const o = prev.get(normName(p.name))
      return { name: p.name, from: o?.earningsCents ?? null, to: p.earningsCents, activeFrom: o?.active ?? null, activeTo: p.active }
    })
    .filter((c) => c.from !== c.to || c.activeFrom !== c.activeTo)
  return { staleSummary, staleProjects, summaryChanged, projectChanges }
}
