// Google Sheets sync against an in-memory spreadsheet with the same layout as
// the owner's workbook (synthetic values).
import { describe, expect, it } from 'vitest'
import { buildSheetModel, repointRanges, serial, spreadsheetIdFrom, syncSpreadsheet } from './sheets'
import { existingWorkbook, FakeSheets } from '../test/fakeSheets'
import { groupTotals, lifetimeTotals, monthBucket } from './calc'
import type { Payment } from './types'

let n = 0
const pay = (p: Partial<Payment>): Payment => ({
  id: `p${++n}`, contract: 'Drafter', type: 'hourly', workStart: null, workEnd: null, payoutDate: null, hours: null,
  earningsCents: 0, rateCents: null, status: 'paid', releaseDate: null, source: 'import', createdAt: 0, updatedAt: 0, ...p,
})

const payments: Payment[] = [
  pay({ workStart: '2026-10-24', workEnd: '2026-10-30', payoutDate: '2026-11-04', releaseDate: '2026-11-04', hours: 18.49, earningsCents: 157153, rateCents: 8500 }),
  pay({ type: 'incentive', contract: 'Agent Work', workStart: '2026-10-21', workEnd: '2026-10-21', payoutDate: '2026-10-23', earningsCents: 40000 }),
  pay({ workStart: '2026-11-07', workEnd: '2026-11-13', payoutDate: '2026-11-19', hours: 18.42, earningsCents: 156543, rateCents: 8500 }),
  pay({ type: 'incentive', payoutDate: '2026-11-19', earningsCents: 21500 }),
  pay({ type: 'incentive', payoutDate: '2026-11-19', earningsCents: 12500 }),
  pay({ type: 'work_trial', contract: 'Trial Co', workStart: '2026-11-08', workEnd: '2026-11-08', payoutDate: '2026-11-13', earningsCents: 10000 }),
  pay({ contract: 'Lead Dev', workStart: '2026-11-14', workEnd: '2026-11-20', payoutDate: '2026-11-25', hours: 0, earningsCents: 4, rateCents: 8500, status: 'pending' }),
  pay({ contract: 'Lead Dev', workStart: '2026-11-21', workEnd: '2026-11-27', payoutDate: '2026-12-02', hours: 38.61, earningsCents: 328173, rateCents: 8500, status: 'pending' }),
  pay({ workStart: '2026-11-28', workEnd: '2026-12-04', payoutDate: '2026-12-09', hours: 6, earningsCents: 51000, rateCents: 8500, status: 'pending' }),
  pay({ contract: 'X', earningsCents: 999, status: 'failed', payoutDate: '2026-11-01' }),
]
const projects = [{ name: 'Alpha', earningsCents: 400000, active: true }, { name: 'Beta', earningsCents: 376873, active: true }]

describe('sheet model', () => {
  it('builds month rows in the workbook format', () => {
    const m = buildSheetModel(payments, projects)
    expect(m.months.map((x) => x.tab)).toEqual(['October 2026', 'November 2026', 'December 2026'])
    const nov = m.months[1].rows
    // Sorted by work date (period end): the Nov 8 trial comes before the Nov 7–13 week
    expect(nov[0][0]).toBe('Work Trial · Nov 8')
    expect(nov.find((r) => r[0] === 'Nov 7–13')).toEqual(['Nov 7–13', 'Drafter', 18.42, 85, 1565.43, 'Paid', serial('2026-11-19'), '', serial('2026-11-13')])
    expect(nov.find((r) => r[4] === 215)![0]).toBe('Incentive · Nov 19')
    expect(nov.find((r) => r[4] === 100)!.slice(0, 6)).toEqual(['Work Trial · Nov 8', 'Trial Co', '', '', 100, 'Paid'])
    expect(nov.find((r) => r[4] === 0.04)!.slice(0, 6)).toEqual(['Nov 14–20', 'Lead Dev', 0, 85, 0.04, 'Upcoming'])
    expect(m.months[2].rows[0][0]).toBe('Nov 28–Dec 4')
    expect(serial('2026-11-19')).toBe(46345)
  })
  it('groups 21st-to-21st cycles by work date with exclusive end labels', () => {
    const m = buildSheetModel(payments, projects)
    expect(m.cycles.map((c) => c.label)).toEqual(['Oct 21 – Nov 21', 'Nov 21 – Dec 21'])
  })
  it('parses spreadsheet links', () => {
    expect(spreadsheetIdFrom('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdE/edit?usp=sharing')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdE')
    expect(spreadsheetIdFrom('not a link')).toBeNull()
  })
  it('re-points range formulas', () => {
    expect(repointRanges('=SUMIF(F7:F9,"Paid",E7:E9)', 7, 15)).toBe('=SUMIF(F7:F15,"Paid",E7:E15)')
  })
})

describe('sync into the existing workbook', () => {
  it('updates month tabs, adds December by copying November, rewires Overview — totals match the app', async () => {
    const fs = existingWorkbook()
    const res = await syncSpreadsheet(fs, buildSheetModel(payments, projects), new Date('2026-11-25T20:00:00Z'))
    expect(res.createdTabs).toEqual(['December 2026'])
    expect(fs.sheets.map((s) => s.title)).toEqual(['Overview', 'October 2026', 'November 2026', 'December 2026', 'Earnings data'])

    const months = groupTotals(payments, monthBucket)
    // Month tab formulas evaluate to the app's per-month totals (work-period attribution by period end)
    const novRows = buildSheetModel(payments, projects).months[1].rows
    const novTotal = novRows.reduce((s, r) => s + (r[4] as number), 0)
    expect(fs.value('November 2026', 'B3')).toBeCloseTo(novTotal, 2)
    expect(fs.value('November 2026', 'D3')).toBeCloseTo(novRows.filter((r) => r[5] === 'Paid').reduce((s, r) => s + (r[4] as number), 0), 2)
    expect(fs.value('November 2026', 'F3')).toBeCloseTo(novRows.filter((r) => r[5] === 'Upcoming').reduce((s, r) => s + (r[4] as number), 0), 2)
    expect(fs.value('November 2026', 'D4')).toBeCloseTo(215 + 125 + 100, 2)
    // Old placeholder rows are gone, TOTAL row formulas cover all rows
    const nov = fs.tab('November 2026').grid
    const totalRow = nov.findIndex((r) => r[0] === 'TOTAL')
    expect(totalRow).toBe(6 + novRows.length)
    expect(nov[totalRow][4]).toBe(`=SUM(E7:E${6 + novRows.length})`)
    expect(nov[totalRow + 3]).toEqual(['Nov 2026', '=D3', '=F3']) // rows below TOTAL kept
    // October shrank from 3 rows to 2
    expect(fs.tab('October 2026').grid.findIndex((r) => r[0] === 'TOTAL')).toBe(8)
    expect(fs.value('October 2026', 'B3')).toBeCloseTo(1971.53, 2)
    // New December tab: copied layout, relabelled, own rows
    expect(fs.tab('December 2026').grid[0][0]).toBe('Dec 2026 | Work earnings')
    expect(fs.value('December 2026', 'B3')).toBeCloseTo(510, 2)

    // Overview: one row per month tab, TOTAL = lifetime tracked total (excluding failed)
    const ov = fs.tab('Overview').grid
    const mStart = ov.findIndex((r) => r[0] === 'MONTHLY EARNINGS') + 2
    expect(ov.slice(mStart, mStart + 3).map((r) => r[0])).toEqual(['Oct 2026', 'Nov 2026', 'Dec 2026'])
    const tot = ov.findIndex((r, i) => i > mStart && r[0] === 'TOTAL')
    expect(fs.value('Overview', `E${tot + 1}`)).toBeCloseTo(lifetimeTotals(payments).totalCents / 100, 2)
    // Top cards still point at the (moved) TOTAL row
    expect(fs.value('Overview', 'B3')).toBeCloseTo(lifetimeTotals(payments).totalCents / 100, 2)
    // Projects section rewritten, owner's note below it kept
    const pStart = ov.findIndex((r) => String(r[0]).startsWith('PROJECT EARNINGS')) + 2
    expect(ov.slice(pStart, pStart + 2)).toEqual([['Alpha', 4000], ['Beta', 3768.73]])
    expect(ov[pStart + 3][0]).toBe('Note: kept as written by the owner')
    // Data tab has every payment
    expect(fs.tab('Earnings data').grid.length).toBe(2 + payments.length)
    void months
  })

  it('is stable when run twice (no duplicated rows or tabs)', async () => {
    const fs = existingWorkbook()
    const model = buildSheetModel(payments, projects)
    await syncSpreadsheet(fs, model)
    const snapshot = JSON.stringify(fs.sheets.map((s) => [s.title, s.grid]).slice(0, 4))
    await syncSpreadsheet(fs, model)
    expect(JSON.stringify(fs.sheets.map((s) => [s.title, s.grid]).slice(0, 4))).toBe(snapshot)
  })

  it('builds a complete workbook from an empty spreadsheet', async () => {
    const fs = new FakeSheets()
    fs.addTab('Overview', [])
    await syncSpreadsheet(fs, buildSheetModel(payments, projects))
    expect(fs.sheets.map((s) => s.title)).toEqual(['Overview', 'October 2026', 'November 2026', 'December 2026', 'Earnings data'])
    const ov = fs.tab('Overview').grid
    const tot = ov.findIndex((r, i) => i > 6 && r[0] === 'TOTAL')
    expect(fs.value('Overview', `E${tot + 1}`)).toBeCloseTo(lifetimeTotals(payments).totalCents / 100, 2)
    expect(fs.value('Overview', 'B3')).toBeCloseTo(lifetimeTotals(payments).totalCents / 100, 2)
  })
})
