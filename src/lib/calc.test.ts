import { describe, expect, it } from 'vitest'
import { allocate, cycleBucket, effectiveHourlyCents, groupTotals, lifetimeTotals, monthBucket, rangeTotals, monthsWithData } from './calc'
import { cycleFor } from './dates'
import { splitCents, parseMoneyToCents, formatCents } from './money'
import { inferRate } from './rates'
import type { Payment } from './types'

let n = 0
function pay(p: Partial<Payment>): Payment {
  n++
  return {
    id: `p${n}`, contract: 'Atlas Writer', type: 'hourly', workStart: null, workEnd: null, payoutDate: null,
    hours: null, earningsCents: 0, rateCents: null, status: 'paid', releaseDate: null, source: 'manual',
    createdAt: 0, updatedAt: 0, ...p,
  }
}

describe('money', () => {
  it('parses and formats integer cents', () => {
    expect(parseMoneyToCents('$1,234.56')).toBe(123456)
    expect(parseMoneyToCents('-$5')).toBe(-500)
    expect(parseMoneyToCents('(12.30)')).toBe(-1230)
    expect(parseMoneyToCents('$0.05')).toBe(5)
    expect(parseMoneyToCents('abc')).toBeNull()
    expect(formatCents(123456)).toBe('$1,234.56')
  })
  it('splits cents without losing a cent', () => {
    expect(splitCents(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(splitCents(-100, [1, 1, 1]).reduce((a, b) => a + b)).toBe(-100)
    expect(splitCents(23009, [1, 6]).reduce((a, b) => a + b)).toBe(23009)
  })
  it('sums many small floats exactly', () => {
    const ps = Array.from({ length: 1000 }, () => pay({ earningsCents: 10, workStart: '2026-11-02', workEnd: '2026-11-02' }))
    expect(lifetimeTotals(ps).totalCents).toBe(10000)
  })
})

describe('work-period attribution', () => {
  it('assigns by work period, not payout date', () => {
    const p = pay({ workStart: '2026-11-21', workEnd: '2026-11-27', payoutDate: '2026-12-02', earningsCents: 89250, hours: 10.5 })
    const m = groupTotals([p], monthBucket)
    expect([...m.keys()]).toEqual(['2026-11'])
    expect(m.get('2026-11')!.totalCents).toBe(89250)
    expect(m.get('2026-11')!.estimated).toBe(false)
  })
  it('splits month-crossing periods by day and marks them estimated', () => {
    const p = pay({ workStart: '2026-10-31', workEnd: '2026-11-06', earningsCents: 70000, hours: 7 })
    const s = allocate(p, monthBucket)
    expect(s).toEqual([
      { key: '2026-10', cents: 10000, hours: 1, estimated: true },
      { key: '2026-11', cents: 60000, hours: 6, estimated: true },
    ])
  })
  it('handles year boundaries', () => {
    const p = pay({ workStart: '2026-12-28', workEnd: '2027-01-03', earningsCents: 70000 })
    const m = groupTotals([p], monthBucket)
    expect(m.get('2026-12')!.totalCents).toBe(40000)
    expect(m.get('2027-01')!.totalCents).toBe(30000)
  })
  it('manual month allocation overrides the estimate', () => {
    const p = pay({
      workStart: '2026-10-31', workEnd: '2026-11-06', earningsCents: 150519,
      allocation: [{ month: '2026-10', cents: 23009, hours: 2.71 }, { month: '2026-11', cents: 127510, hours: 15 }],
    })
    const m = groupTotals([p], monthBucket)
    expect(m.get('2026-10')!.totalCents).toBe(23009)
    expect(m.get('2026-10')!.estimated).toBe(false)
  })
  it('incentives without a work period use the payout date', () => {
    const p = pay({ type: 'incentive', payoutDate: '2026-11-25', earningsCents: 21500 })
    expect([...groupTotals([p], monthBucket).keys()]).toEqual(['2026-11'])
  })
  it('lists continuous months', () => {
    expect(monthsWithData([pay({ payoutDate: '2026-10-05', earningsCents: 1 }), pay({ payoutDate: '2027-01-02', earningsCents: 1 })]))
      .toEqual(['2026-10', '2026-11', '2026-12', '2027-01'])
  })
})

describe('21st-to-21st cycles', () => {
  it('computes cycle bounds (end date exclusive of next start)', () => {
    expect(cycleFor('2026-11-21', 21)).toEqual({ key: '2026-11-21', start: '2026-11-21', end: '2026-12-20' })
    expect(cycleFor('2026-11-20', 21)).toEqual({ key: '2026-10-21', start: '2026-10-21', end: '2026-11-20' })
    expect(cycleFor('2027-01-05', 21)).toEqual({ key: '2026-12-21', start: '2026-12-21', end: '2027-01-20' })
    expect(cycleFor('2026-02-27', 31)).toEqual({ key: '2026-01-31', start: '2026-01-31', end: '2026-02-27' })
    expect(cycleFor('2026-02-28', 31)).toEqual({ key: '2026-02-28', start: '2026-02-28', end: '2026-03-30' })
  })
  it('groups payments into cycles', () => {
    const ps = [
      pay({ workStart: '2026-11-14', workEnd: '2026-11-20', earningsCents: 340021 }),
      pay({ workStart: '2026-11-21', workEnd: '2026-11-27', earningsCents: 317388 }),
      pay({ workStart: '2026-11-18', workEnd: '2026-11-24', earningsCents: 7000 }),
    ]
    const c = groupTotals(ps, cycleBucket(21))
    expect(c.get('2026-10-21')!.totalCents).toBe(340021 + 3000)
    expect(c.get('2026-11-21')!.totalCents).toBe(317388 + 4000)
    expect(c.get('2026-11-21')!.estimated).toBe(true)
  })
})

describe('totals and rates', () => {
  const ps = [
    pay({ workStart: '2026-11-07', workEnd: '2026-11-13', hours: 18.42, earningsCents: 156543, rateCents: 8500, status: 'paid' }),
    pay({ workStart: '2026-11-14', workEnd: '2026-11-20', hours: 40, earningsCents: 340021, rateCents: 8500, status: 'pending' }),
    pay({ type: 'incentive', workStart: '2026-11-12', workEnd: '2026-11-12', earningsCents: 21500, status: 'paid' }),
    pay({ type: 'work_trial', workStart: '2026-11-08', workEnd: '2026-11-08', earningsCents: 10000, status: 'paid' }),
    pay({ type: 'hourly', workStart: '2026-11-08', workEnd: '2026-11-08', earningsCents: 999, status: 'failed' }),
  ]
  it('computes paid, pending, hourly, incentive and trial totals', () => {
    const t = lifetimeTotals(ps)
    expect(t.totalCents).toBe(156543 + 340021 + 21500 + 10000)
    expect(t.paidCents).toBe(156543 + 21500 + 10000)
    expect(t.pendingCents).toBe(340021)
    expect(t.hourlyCents).toBe(156543 + 340021)
    expect(t.incentiveCents).toBe(21500)
    expect(t.trialCents).toBe(10000)
    expect(t.hours).toBeCloseTo(58.42)
  })
  it('effective hourly uses actual earnings over rounded hours', () => {
    expect(effectiveHourlyCents(lifetimeTotals(ps))).toBe(Math.round((156543 + 340021) / 58.42))
  })
  it('custom ranges prorate partial overlap', () => {
    const t = rangeTotals(ps, '2026-11-10', '2026-11-13')
    expect(t.totalCents).toBe(Math.round((156543 * 4) / 7) + 21500)
    expect(t.estimated).toBe(true)
  })
  it('infers $65/$85 with rounded hours and leaves incentives unrated', () => {
    const base = { preferredRates: [65, 85], tolerancePct: 3 }
    expect(inferRate({ ...base, type: 'hourly', earningsCents: 156543, hours: 18.42 }).rateCents).toBe(8500)
    expect(inferRate({ ...base, type: 'hourly', earningsCents: 33149, hours: 5.1 }).rateCents).toBe(6500)
    expect(inferRate({ ...base, type: 'hourly', earningsCents: 23009, hours: 2.71 }).rateCents).toBe(8500)
    expect(inferRate({ ...base, type: 'hourly', earningsCents: 5, hours: 0, contractRateCents: 6500 }).rateCents).toBe(6500)
    expect(inferRate({ ...base, type: 'hourly', earningsCents: 10000, hours: 2 }).rateCents).toBe(5000)
    expect(inferRate({ ...base, type: 'incentive', earningsCents: 21500, hours: null }).rateCents).toBeNull()
    expect(inferRate({ ...base, type: 'work_trial', earningsCents: 10000, hours: 1 }).rateCents).toBeNull()
  })
})
