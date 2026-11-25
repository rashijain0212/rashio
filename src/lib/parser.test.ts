import { describe, expect, it } from 'vitest'
import { parseDashboardText, parseRange, parseSingleDate, parseHours } from './parser'
import { NOW, PAGE_LINES, PAGE_NO_YEARS, PAGE_TABS } from '../test/fixtures/sample'

describe('parseDashboardText — line-per-cell page', () => {
  const r = parseDashboardText(PAGE_LINES, { now: NOW })

  it('extracts summary figures', () => {
    expect(r.summary).toEqual({
      lifetimeCents: 247000,
      currentPayoutCents: 125000,
      nextPayoutCents: 125000,
      nextPayoutDate: '2026-12-02',
      paidThisMonthCents: 122000,
      payoutCount: 4,
    })
  })

  it('extracts projects with active status, ignoring chart labels', () => {
    expect(r.projects).toEqual([
      { name: 'Atlas', earningsCents: 133250, active: true },
      { name: 'Orion', earningsCents: 113750, active: false },
    ])
  })

  it('extracts every payment row with all fields', () => {
    expect(r.payments).toHaveLength(6)
    expect(r.payments[0]).toMatchObject({
      payoutDate: '2026-12-02',
      contract: 'Atlas Writer',
      type: 'hourly',
      workStart: '2026-11-21',
      workEnd: '2026-11-27',
      hours: 10.5,
      earningsCents: 89250,
      status: 'pending',
      statusLabel: 'Upcoming',
    })
    expect(r.payments[2]).toMatchObject({
      contract: 'Atlas Writer',
      type: 'incentive',
      workStart: '2026-11-12',
      workEnd: '2026-11-12',
      earningsCents: 21500,
      status: 'paid',
      releaseDate: '2026-11-24',
      releaseKind: 'actual',
      hours: null,
    })
    expect(r.payments[3].earningsCents).toBe(12500)
    expect(r.payments[4]).toMatchObject({ workStart: '2026-10-31', workEnd: '2026-11-06', hours: 12 })
    expect(r.payments[5]).toMatchObject({ type: 'work_trial', earningsCents: 10000, payoutDate: '2026-11-04' })
  })

  it('reconciles: payments sum to lifetime earnings', () => {
    expect(r.payments.reduce((a, p) => a + p.earningsCents, 0)).toBe(r.summary.lifetimeCents)
    expect(r.warnings).toEqual([])
  })
})

describe('parseDashboardText — tab-separated rows', () => {
  const r = parseDashboardText(PAGE_TABS, { now: NOW })
  it('parses the same data', () => {
    const a = parseDashboardText(PAGE_LINES, { now: NOW })
    const pick = (x: typeof r.payments) =>
      x.map(({ contract, type, workStart, workEnd, payoutDate, hours, earningsCents, status }) => ({
        contract, type, workStart, workEnd, payoutDate, hours: hours ?? null, earningsCents, status,
      }))
    expect(pick(r.payments)).toEqual(pick(a.payments))
    expect(r.summary.lifetimeCents).toBe(247000)
    expect(r.summary.nextPayoutDate).toBe('2026-12-02')
    expect(r.summary.payoutCount).toBe(4)
  })
  it('reads status-with-date cells as release dates', () => {
    expect(r.payments[2]).toMatchObject({ status: 'paid', releaseDate: '2026-11-24' })
  })
})

describe('dates without years', () => {
  it('infers years, including ranges crossing New Year', () => {
    const r = parseDashboardText(PAGE_NO_YEARS, { now: new Date(2027, 0, 5) })
    expect(r.payments[0]).toMatchObject({ payoutDate: '2026-12-02', workStart: '2026-11-21', workEnd: '2026-11-27' })
    expect(r.payments[1]).toMatchObject({ payoutDate: '2027-01-07', workStart: '2026-12-28', workEnd: '2027-01-03' })
  })
  it('parses single dates and ranges', () => {
    expect(parseSingleDate('Nov 3, 2026', NOW)).toBe('2026-11-03')
    expect(parseSingleDate('11/03/2026', NOW)).toBe('2026-11-03')
    expect(parseSingleDate('2026-11-03', NOW)).toBe('2026-11-03')
    expect(parseSingleDate('Feb 30, 2026', NOW)).toBeNull()
    expect(parseRange('Oct 31 - Nov 6, 2026', NOW, null)).toEqual({ start: '2026-10-31', end: '2026-11-06' })
    expect(parseRange('Dec 28, 2025 - Jan 3, 2026', NOW, null)).toEqual({ start: '2025-12-28', end: '2026-01-03' })
    expect(parseRange('Nov 7-13', NOW, '2026-11-18')).toEqual({ start: '2026-11-07', end: '2026-11-13' })
  })
  it('parses hour formats', () => {
    expect(parseHours('10.5 hrs')).toBe(10.5)
    expect(parseHours('2h 30m')).toBe(2.5)
    expect(parseHours('1:15')).toBe(1.25)
    expect(parseHours('0.00 hours')).toBe(0)
    expect(parseHours('$5')).toBeNull()
  })
})

describe('invalid and incomplete input', () => {
  it('handles empty text', () => {
    const r = parseDashboardText('   \n  ', { now: NOW })
    expect(r.payments).toEqual([])
    expect(r.warnings[0]).toMatch(/empty/i)
  })
  it('handles unrelated text', () => {
    const r = parseDashboardText('Hello world\nThis is not an earnings page\nLorem ipsum', { now: NOW })
    expect(r.payments).toEqual([])
    expect(r.warnings[0]).toMatch(/no earnings data was recognised/i)
  })
  it('handles summary-only pastes', () => {
    const r = parseDashboardText('Total earnings\n$1,000.00\nPaid this month\n$200.00', { now: NOW })
    expect(r.summary.lifetimeCents).toBe(100000)
    expect(r.payments).toEqual([])
    expect(r.warnings[0]).toMatch(/only summary/i)
  })
  it('drops truncated rows without an amount', () => {
    const r = parseDashboardText('Payout history\nDec 2, 2026\nAtlas Writer\nHourly\nNov 21 - Nov 27, 2026', { now: NOW })
    expect(r.payments).toEqual([])
  })
  it('flags partial pages via payout count', () => {
    const text = PAGE_LINES.split('Nov 25, 2026\nAtlas Writer')[0]
    const r = parseDashboardText(text, { now: NOW })
    expect(r.payments).toHaveLength(2)
    expect(r.warnings.join(' ')).toMatch(/partial page/i)
  })
  it('parses negative adjustments', () => {
    const r = parseDashboardText('Payout history\nDec 9, 2026\tAtlas Writer\tAdjustment\tNov 20, 2026\t\t-$12.50\tPaid', { now: NOW })
    expect(r.payments[0]).toMatchObject({ type: 'other', earningsCents: -1250 })
  })
})
