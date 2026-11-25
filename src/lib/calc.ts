// Earnings aggregation. Money is integer cents throughout.
// Payments are attributed to the period in which the work happened, not the payout date.

import type { Payment } from './types'
import {
  addDays,
  cycleFor,
  daysInclusive,
  fromDayNumber,
  monthBounds,
  monthKey,
  toDayNumber,
} from './dates'
import { splitCents } from './money'

export interface Totals {
  totalCents: number
  paidCents: number
  pendingCents: number
  failedCents: number
  hourlyCents: number
  incentiveCents: number
  trialCents: number
  otherCents: number
  hours: number
  count: number
  estimated: boolean
}

export function emptyTotals(): Totals {
  return {
    totalCents: 0,
    paidCents: 0,
    pendingCents: 0,
    failedCents: 0,
    hourlyCents: 0,
    incentiveCents: 0,
    trialCents: 0,
    otherCents: 0,
    hours: 0,
    count: 0,
    estimated: false,
  }
}

export function isPending(p: Pick<Payment, 'status'>): boolean {
  return p.status === 'pending' || p.status === 'processing' || p.status === 'other'
}

/** Work interval used for attribution: work period, else payout date, else release date. */
export function workInterval(p: Pick<Payment, 'workStart' | 'workEnd' | 'payoutDate' | 'releaseDate'>): [string, string] | null {
  if (p.workStart) return [p.workStart, p.workEnd ?? p.workStart]
  if (p.workEnd) return [p.workEnd, p.workEnd]
  if (p.payoutDate) return [p.payoutDate, p.payoutDate]
  if (p.releaseDate) return [p.releaseDate, p.releaseDate]
  return null
}

export interface Slice {
  key: string
  cents: number
  hours: number
  estimated: boolean
}

/**
 * Allocate a payment across buckets. `bucketOf(day)` returns [key, start, end]
 * for the bucket containing a day. When the work interval crosses buckets the
 * amount is split by days and flagged as estimated (no daily data is available).
 * Manual allocations (`allocation` field) override this when present.
 */
export function allocate(
  p: Payment,
  bucketOf: (iso: string) => { key: string; start: string; end: string },
): Slice[] {
  const iv = workInterval(p)
  if (!iv) return []
  const [a, b] = iv
  const first = bucketOf(a)
  if (b <= first.end) return [{ key: first.key, cents: p.earningsCents, hours: p.hours ?? 0, estimated: false }]

  const parts: { key: string; days: number }[] = []
  let cursor = a
  while (cursor <= b) {
    const bk = bucketOf(cursor)
    const end = bk.end < b ? bk.end : b
    parts.push({ key: bk.key, days: daysInclusive(cursor, end) })
    cursor = addDays(end, 1)
  }
  const cents = splitCents(p.earningsCents, parts.map((x) => x.days))
  const hoursSplit = splitCents(Math.round((p.hours ?? 0) * 100), parts.map((x) => x.days))
  return parts.map((x, i) => ({ key: x.key, cents: cents[i], hours: hoursSplit[i] / 100, estimated: true }))
}

export const monthBucket = (iso: string) => {
  const key = monthKey(iso)
  const [start, end] = monthBounds(key)
  return { key, start, end }
}

export const cycleBucket = (startDay: number) => (iso: string) => cycleFor(iso, startDay)

function addTo(t: Totals, p: Payment, cents: number, hours: number, estimated: boolean) {
  t.totalCents += cents
  if (p.status === 'paid') t.paidCents += cents
  else if (p.status === 'failed') t.failedCents += cents
  else t.pendingCents += cents
  if (p.type === 'hourly') {
    t.hourlyCents += cents
    t.hours += hours
  } else if (p.type === 'incentive') t.incentiveCents += cents
  else if (p.type === 'work_trial') t.trialCents += cents
  else t.otherCents += cents
  t.count += 1
  if (estimated) t.estimated = true
}

/** Exclude failed payments from earnings totals (they were never earned/paid). */
export function countable(p: Payment): boolean {
  return p.status !== 'failed'
}

export function groupTotals(
  payments: Payment[],
  bucketOf: (iso: string) => { key: string; start: string; end: string },
): Map<string, Totals> {
  const out = new Map<string, Totals>()
  for (const p of payments) {
    if (!countable(p)) continue
    for (const s of allocateWithOverride(p, bucketOf)) {
      const t = out.get(s.key) ?? emptyTotals()
      addTo(t, p, s.cents, s.hours, s.estimated)
      out.set(s.key, t)
    }
  }
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
}

function allocateWithOverride(p: Payment, bucketOf: (iso: string) => { key: string; start: string; end: string }): Slice[] {
  const alloc = validAllocation(p)
  if (alloc && bucketOf === monthBucket) {
    return alloc.map((a) => ({ key: a.month, cents: a.cents, hours: a.hours ?? 0, estimated: false }))
  }
  return allocate(p, bucketOf)
}

export function lifetimeTotals(payments: Payment[]): Totals {
  const t = emptyTotals()
  for (const p of payments) if (countable(p)) addTo(t, p, p.earningsCents, p.hours ?? 0, false)
  return t
}

/** Totals for a custom inclusive date range, prorating work intervals that straddle it. */
export function rangeTotals(payments: Payment[], from: string, to: string): Totals {
  const t = emptyTotals()
  const bucket = (iso: string) => {
    if (iso < from) return { key: 'before', start: '0000-01-01', end: addDays(from, -1) }
    if (iso > to) return { key: 'after', start: addDays(to, 1), end: '9999-12-31' }
    return { key: 'in', start: from, end: to }
  }
  for (const p of payments) {
    if (!countable(p)) continue
    for (const s of allocate(p, bucket)) if (s.key === 'in') addTo(t, p, s.cents, s.hours, s.estimated)
  }
  return t
}

export function effectiveHourlyCents(t: Pick<Totals, 'hourlyCents' | 'hours'>): number | null {
  if (t.hours <= 0) return null
  return Math.round(t.hourlyCents / t.hours)
}

export function groupBy<K extends string>(payments: Payment[], keyOf: (p: Payment) => K): Map<K, Totals> {
  const out = new Map<K, Totals>()
  for (const p of payments) {
    if (!countable(p)) continue
    const k = keyOf(p)
    const t = out.get(k) ?? emptyTotals()
    addTo(t, p, p.earningsCents, p.hours ?? 0, false)
    out.set(k, t)
  }
  return out
}

export function upcomingPayouts(payments: Payment[], today: string): { date: string; cents: number; count: number }[] {
  const m = new Map<string, { cents: number; count: number }>()
  for (const p of payments) {
    if (!isPending(p)) continue
    const d = p.releaseDate ?? p.payoutDate
    if (!d || d < addDays(today, -14)) continue
    const cur = m.get(d) ?? { cents: 0, count: 0 }
    cur.cents += p.earningsCents
    cur.count += 1
    m.set(d, cur)
  }
  return [...m.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** Every month key that has attributed work, filling gaps between first and last. */
export function monthsWithData(payments: Payment[]): string[] {
  const keys = [...groupTotals(payments, monthBucket).keys()]
  if (!keys.length) return []
  const out: string[] = []
  let n = toDayNumber(`${keys[0]}-01`)
  const last = `${keys[keys.length - 1]}-01`
  while (fromDayNumber(n) <= last) {
    const k = fromDayNumber(n).slice(0, 7)
    out.push(k)
    const [y, mo] = k.split('-').map(Number)
    n = toDayNumber(mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`)
  }
  return out
}

/** A manual month split is used only while it still adds up to the payment's earnings. */
export function validAllocation(p: Payment): NonNullable<Payment['allocation']> | null {
  const a = p.allocation
  if (!a || !a.length) return null
  return a.reduce((s, x) => s + x.cents, 0) === p.earningsCents ? a : null
}
