// Tracked payments vs the dashboard's headline and itemised totals (synthetic numbers).
import { describe, expect, it } from 'vitest'
import { compareTotals, itemisedCents } from './totals'
import type { ParsedSummary } from './types'

const summary = (lifetime: number | null, chart: number | null = null): ParsedSummary => ({
  lifetimeCents: lifetime, currentPayoutCents: null, nextPayoutCents: null, nextPayoutDate: null, paidThisMonthCents: null, payoutCount: null, chartTotalCents: chart,
})
const projects = [{ name: 'Alpha', earningsCents: 400000, active: true }, { name: 'Beta', earningsCents: 308504, active: false }]

describe('itemised total', () => {
  it('prefers the chart total, else sums the project cards', () => {
    expect(itemisedCents(summary(1, 999))).toBe(999)
    expect(itemisedCents(summary(1), projects)).toBe(708504)
    expect(itemisedCents(summary(1))).toBeNull()
  })
})

describe('compareTotals', () => {
  it('matches when every listed payment is tracked and the headline runs ahead (work not listed yet)', () => {
    expect(compareTotals(708504, summary(711246, 708504))).toEqual({ reported: 711246, itemised: 708504, diff: 0, unlisted: 2742 })
    expect(compareTotals(708504, summary(711246), projects)).toMatchObject({ diff: 0, unlisted: 2742 })
  })

  it('still warns when the tracked payments differ from the listed payments', () => {
    expect(compareTotals(700000, summary(711246, 708504))).toMatchObject({ diff: 11246, unlisted: 0 })
  })

  it('still warns when tracked is above the headline (possible duplicate)', () => {
    expect(compareTotals(720000, summary(711246, 720000))).toMatchObject({ diff: -8754, unlisted: 0 })
  })

  it('warns as before when the page has no itemised total', () => {
    expect(compareTotals(708504, summary(711246))).toMatchObject({ itemised: null, diff: 2742, unlisted: 0 })
  })

  it('exact match and no dashboard totals', () => {
    expect(compareTotals(708504, summary(708504, 708504))).toMatchObject({ diff: 0, unlisted: 0 })
    expect(compareTotals(708504, null)).toMatchObject({ reported: null, diff: null })
  })
})
