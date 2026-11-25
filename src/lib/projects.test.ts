import { describe, expect, it } from 'vitest'
import { inferProjectMap, projectRows } from './projects'
import { ordinal } from './dates'
import type { Payment } from './types'

const pay = (contract: string, cents: number, status: Payment['status'] = 'paid'): Payment => ({
  id: `${contract}-${cents}`, contract, type: 'hourly', workStart: null, workEnd: null, payoutDate: null, hours: null,
  earningsCents: cents, rateCents: null, status, releaseDate: null, source: 'import', createdAt: 0, updatedAt: 0,
})
const payments = [pay('Drafter', 10000), pay('Drafter', 5000), pay('Acme Engineers (Agent Work Experience)', 7000), pay('Lead Dev', 4000), pay('Trial Co', 1000), pay('Lead Dev', 999, 'failed')]
const projects = [
  { name: 'Alpha', earningsCents: 15000, active: true },
  { name: 'Beta', earningsCents: 7000, active: true },
  { name: 'Gamma', earningsCents: 4000, active: true },
  { name: 'Trial Co', earningsCents: 1000, active: false },
]

describe('project mapping', () => {
  it('learns project → contract from exact totals and equal names', () => {
    expect(inferProjectMap(projects, payments)).toEqual({
      'Trial Co': ['Trial Co'],
      Alpha: ['Drafter'],
      Beta: ['Acme Engineers (Agent Work Experience)'],
      Gamma: ['Lead Dev'],
    })
  })
  it('does not guess when several combinations match', () => {
    expect(inferProjectMap([{ name: 'X', earningsCents: 11000, active: true }], [pay('A', 5500), pay('B', 5500), pay('C', 11000)])).toEqual({})
  })
  it('shows tracked totals next to dashboard totals; manual mapping wins', () => {
    const rows = projectRows(projects, payments, { Alpha: ['drafter', 'Lead Dev'] }, inferProjectMap(projects, payments))
    expect(rows.find((r) => r.name === 'Alpha')).toMatchObject({ trackedCents: 19000, reportedCents: 15000, source: 'manual' })
    expect(rows.find((r) => r.name === 'Beta')).toMatchObject({ trackedCents: 7000, reportedCents: 7000, source: 'learned' })
  })
  it('formats ordinals for cycle labels', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st'])
  })
})
