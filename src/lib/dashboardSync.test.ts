// Regression tests in the real the dashboard clipboard format (synthetic data).
import { describe, expect, it } from 'vitest'
import { parseDashboardText } from './parser'
import { laDateISO, parseRow } from './dashboard'
import { finalState, planImport, resolveContract } from './sync'
import { commitImportEx, MemoryDb, restoreBackup, savePayment, ConflictError } from './store'
import { lifetimeTotals } from './calc'
import { DEFAULT_SETTINGS, type Payment } from './types'
import { dashboard, dashboardCells, LONG, R, row, type Row } from '../test/fixtures/dashboardFixture'

const UID = 'u'
const NOW = new Date('2026-11-25T18:00:00Z') // Nov 25 in Los Angeles
const stored = (db: MemoryDb) => db.list(`users/${UID}/payments/`) as unknown as Payment[]
const rev = (db: MemoryDb) => (db.docs.get(`users/${UID}/meta/sync`)?.data.revision as number) ?? 0
const writes = (db: MemoryDb) => [...db.docs.values()].reduce((a, d) => a + d.version, 0)

async function sync(db: MemoryDb, text: string, resolutions: Record<number, string> = {}) {
  const parsed = parseDashboardText(text, { now: NOW })
  const plan = planImport(stored(db), parsed, DEFAULT_SETTINGS, rev(db))
  const before = lifetimeTotals(stored(db)).totalCents
  const after = lifetimeTotals(finalState(stored(db), plan, resolutions)).totalCents
  const res = await commitImportEx(db, { uid: UID, plan, resolutions, summary: parsed.summary, projects: parsed.projects, now: 1000 + rev(db), totals: { before, after } })
  return { plan, res, parsed }
}
const kinds = (plan: { items: { kind: string }[] }) =>
  plan.items.reduce<Record<string, number>>((a, i) => ({ ...a, [i.kind]: (a[i.kind] ?? 0) + 1 }), {})

const ALL: Row[] = [R.draftCur, R.seniorCur, R.draftPrev, R.leadTiny, R.agentInc, R.agentHrs, R.draftInc1, R.draftInc2]
const LIFE = '$7,085.04' // sum of ALL
const page = (rows: Row[], extra: Partial<Parameters<typeof dashboard>[0]> = {}) =>
  dashboard({ lifetime: LIFE, rows, projects: [{ name: 'Alpha', total: '$4,000.00', active: true }, { name: 'Beta', total: '$3,085.04', active: false }], ...extra })

// Historical records as they might come from the old spreadsheet (short names, hand-entered incentive dates)
function history(): Payment[] {
  const base = { source: 'manual' as const, createdAt: 1, updatedAt: 1, rateCents: null, releaseKind: null }
  return [
    { ...base, id: 'h1', contract: 'Drafter', type: 'hourly', workStart: '2026-11-21', workEnd: '2026-11-27', payoutDate: '2026-12-02', hours: 1.5, earningsCents: 12750, rateCents: 8500, status: 'pending', releaseDate: '2026-12-02' },
    { ...base, id: 'h2', contract: 'Lead Dev', type: 'hourly', workStart: '2026-11-21', workEnd: '2026-11-27', payoutDate: '2026-12-02', hours: 29.5, earningsCents: 250750, rateCents: 8500, status: 'pending', releaseDate: '2026-12-02' },
    { ...base, id: 'h3', contract: 'Drafter', type: 'hourly', workStart: '2026-11-14', workEnd: '2026-11-20', payoutDate: '2026-11-25', hours: 40, earningsCents: 340000, rateCents: 8500, status: 'pending', releaseDate: '2026-11-25', releaseKind: 'expected' },
    { ...base, id: 'h4', contract: 'Lead Dev', type: 'hourly', workStart: '2026-11-14', workEnd: '2026-11-20', payoutDate: '2026-11-25', hours: 0, earningsCents: 4, rateCents: 8500, status: 'pending', releaseDate: '2026-11-25', releaseKind: 'expected' },
    { ...base, id: 'h5', contract: 'Agent Work', type: 'incentive', workStart: '2026-11-13', workEnd: '2026-11-13', payoutDate: '2026-11-19', hours: null, earningsCents: 30000, status: 'paid', releaseDate: '2026-11-18', releaseKind: 'actual' },
    { ...base, id: 'h6', contract: 'Agent Work', type: 'hourly', workStart: '2026-11-07', workEnd: '2026-11-13', payoutDate: '2026-11-19', hours: 5, earningsCents: 32500, rateCents: 6500, status: 'paid', releaseDate: '2026-11-18', releaseKind: 'actual', notes: 'my note' },
    { ...base, id: 'h7', contract: 'Drafter', type: 'incentive', workStart: '2026-11-12', workEnd: '2026-11-12', payoutDate: '2026-11-19', hours: null, earningsCents: 21500, status: 'paid', releaseDate: '2026-11-18', releaseKind: 'actual' },
    { ...base, id: 'h8', contract: 'Drafter', type: 'incentive', workStart: '2026-11-12', workEnd: '2026-11-12', payoutDate: '2026-11-19', hours: null, earningsCents: 12500, status: 'paid', releaseDate: '2026-11-18', releaseKind: 'actual' },
    { ...base, id: 'h9', contract: 'Agent Work', type: 'hourly', workStart: '2026-10-24', workEnd: '2026-10-30', payoutDate: '2026-11-04', hours: 10, earningsCents: 65000, rateCents: 6500, status: 'paid', releaseDate: '2026-11-04', releaseKind: 'actual' },
    { ...base, id: 'h10', contract: 'Trial Co', type: 'work_trial', workStart: '2026-11-08', workEnd: '2026-11-08', payoutDate: '2026-11-13', hours: null, earningsCents: 10000, status: 'paid', releaseDate: '2026-11-12', releaseKind: 'actual' },
  ] as Payment[]
}
async function seeded() {
  const db = new MemoryDb()
  await restoreBackup(db, UID, { app: 'rashio', version: 1, exportedAt: 'x', payments: history() })
  return db
}

describe('the dashboard clipboard format', () => {
  it('parses run-together rows, zero hours, "-" hours, Sent / Released / today (PST)', () => {
    expect(parseRow(row(R.seniorCur), NOW)).toMatchObject({ payoutDate: '2026-12-02', contract: 'Lead Dev', type: 'hourly', workStart: '2026-11-21', workEnd: '2026-11-27', hours: 30, earningsCents: 255000, status: 'pending', releaseDate: '2026-12-02', releaseKind: 'expected' })
    expect(parseRow(row(R.leadTiny), NOW)).toMatchObject({ hours: 0, earningsCents: 4 })
    expect(parseRow(row(R.agentInc), NOW)).toMatchObject({ contract: LONG, type: 'incentive', hours: null, workStart: null, status: 'paid', releaseDate: '2026-11-18', releaseKind: 'actual', releaseText: 'Sent Nov 18, 2026' })
    expect(parseRow(row({ ...R.draftPrev, status: 'Released', release: 'Released Nov 26, 2026' }), NOW)).toMatchObject({ status: 'paid', releaseDate: '2026-11-26', releaseKind: 'actual' })
    expect(parseRow(row(R.draftPrev), NOW)).toMatchObject({ releaseDate: '2026-11-25', releaseKind: 'expected', releaseText: 'Releases today (PST)' })
  })

  it('resolves "today (PST)" in Los Angeles time, not UTC or local', () => {
    // 2026-11-26 05:00 UTC is still Nov 25 in Los Angeles
    expect(laDateISO(new Date('2026-11-26T05:00:00Z'))).toBe('2026-11-25')
    expect(parseRow(row(R.draftPrev), new Date('2026-11-26T05:00:00Z'))!.releaseDate).toBe('2026-11-25')
    expect(laDateISO(new Date('2026-11-26T09:00:00Z'))).toBe('2026-11-26')
  })

  it('reads summary cards and projects separately; ignores nav, chart axis and the Ask Maven $0', () => {
    const r = parseDashboardText(page(ALL, { chart: '$7,000.00' }), { now: NOW })
    expect(r.payments).toHaveLength(8)
    expect(r.summary).toMatchObject({ lifetimeCents: 708504, chartTotalCents: 700000, currentPayoutCents: 0, nextPayoutCents: 5, nextPayoutDate: '2026-11-18', paidThisMonthCents: 10000, payoutCount: 3, stripeStatus: 'Stripe connected', payoutInTransit: 'No payout in transit', missing: [] })
    expect(r.projects).toEqual([{ name: 'Alpha', earningsCents: 400000, active: true }, { name: 'Beta', earningsCents: 308504, active: false }])
    expect(r.warnings).toEqual([])
  })

  it('reports fields it cannot read and malformed rows instead of ignoring them', () => {
    const txt = page([R.draftCur]).replace(/^Total earnings to date.*$/m, 'Total earnings to date').replace(/^Dec 2, 2026Drafter.*$/m, (l) => `${l}\nDec 2, 2026Broken row $5.00`)
    const r = parseDashboardText(txt, { now: NOW })
    expect(r.summary.missing).toContain('Total earnings to date')
    expect(r.warnings.join(' ')).toMatch(/could not be understood/)
    expect(r.payments).toHaveLength(1)
  })
})

describe('contract aliases', () => {
  it('maps long dashboard names to stored short names', () => {
    expect(resolveContract(LONG, ['Agent Work', 'Drafter'])).toBe('Agent Work')
    expect(resolveContract('drafter', ['Drafter'])).toBe('Drafter')
    expect(resolveContract('Something Else', ['Agent Work'])).toBe('Something Else')
    expect(resolveContract('the dashboard Name', ['Mine'], { 'the dashboard Name': 'Mine' })).toBe('Mine')
  })
})

describe('incremental sync on top of history', () => {
  it('updates only what changed: growing earnings/hours, Upcoming → Released, aliases, twin incentives', async () => {
    const db = await seeded()
    const before = lifetimeTotals(stored(db)).totalCents
    const { plan, res } = await sync(db, page(ALL))
    // h1, h2 grew; h3 payout date unchanged (still Nov 25)... everything else unchanged
    expect(kinds(plan)).toEqual({ update: 2, unchanged: 6 })
    expect(plan.preserved).toBe(2)
    expect(res.record!.counts).toMatchObject({ created: 0, updated: 2 })
    expect(stored(db)).toHaveLength(10)
    const h1 = stored(db).find((p) => p.id === 'h1')!
    expect(h1).toMatchObject({ hours: 2, earningsCents: 17000 })
    expect(stored(db).find((p) => p.id === 'h2')).toMatchObject({ hours: 30, earningsCents: 255000 })
    // Aliased incentive kept its stored name and hand-entered date
    expect(stored(db).find((p) => p.id === 'h5')).toMatchObject({ contract: 'Agent Work', workStart: '2026-11-13' })
    expect(lifetimeTotals(stored(db)).totalCents - before).toBe(17000 - 12750 + 255000 - 250750)
  })

  it('is idempotent: the same text again writes nothing and adds no history', async () => {
    const db = await seeded()
    await sync(db, page(ALL))
    const w = writes(db)
    for (let i = 0; i < 3; i++) {
      const { plan, res } = await sync(db, page(ALL))
      expect(kinds(plan)).toEqual({ unchanged: 8 })
      expect(res.noop).toBe(true)
    }
    expect(writes(db)).toBe(w)
    expect(db.list(`users/${UID}/imports/`)).toHaveLength(1)
  })

  it('ignores row order', async () => {
    const db = await seeded()
    await sync(db, page(ALL))
    const { plan } = await sync(db, page([...ALL].reverse()))
    expect(kinds(plan)).toEqual({ unchanged: 8 })
  })

  it('handles several updates in one day and Upcoming → Released with a changed payout date', async () => {
    const db = await seeded()
    await sync(db, page(ALL))
    const later = ALL.map((r) => (r === R.draftCur ? { ...r, hours: '3.00', earned: '$255.00' } : r))
    expect(kinds((await sync(db, page(later))).plan)).toEqual({ update: 1, unchanged: 7 })
    const evening = later.map((r) =>
      r === R.draftPrev ? { ...r, payout: 'Nov 26, 2026', status: 'Released', release: 'Released Nov 26, 2026' } : r,
    )
    const { plan } = await sync(db, page(evening))
    expect(kinds(plan)).toEqual({ update: 1, unchanged: 7 })
    expect(stored(db).find((p) => p.id === 'h3')).toMatchObject({ status: 'paid', payoutDate: '2026-11-26', releaseDate: '2026-11-26', releaseKind: 'actual', statusLabel: 'Released' })
    expect(stored(db).find((p) => p.id === 'h1')).toMatchObject({ hours: 3, earningsCents: 25500 })
    expect(stored(db)).toHaveLength(10)
  })

  it('treats a partial page (only latest rows) as incremental', async () => {
    const db = await seeded()
    const { plan } = await sync(db, page([R.draftCur]))
    expect(kinds(plan)).toEqual({ update: 1 })
    expect(plan.preserved).toBe(9)
    expect(stored(db)).toHaveLength(10)
  })

  it('flags stale snapshots (lower earnings, Paid → Upcoming) and allows confirmed corrections', async () => {
    const db = await seeded()
    await sync(db, page(ALL))
    const stale = ALL.map((r) => (r === R.draftCur ? { ...r, hours: '1.00', earned: '$85.00' } : r === R.agentHrs ? { ...r, status: 'Upcoming', release: 'Releases Nov 19, 2026' } : r))
    const parsed = parseDashboardText(page(stale), { now: NOW })
    const plan = planImport(stored(db), parsed, DEFAULT_SETTINGS, rev(db))
    expect(kinds(plan)).toEqual({ conflict: 2, unchanged: 6 })
    await expect(commitImportEx(db, { uid: UID, plan, resolutions: {}, summary: null, projects: [] })).rejects.toThrow(/Confirm or reject/)
    // Keep saved values for the status regression, apply the downward correction
    const [down, status] = plan.items.filter((i) => i.kind === 'conflict')
    await commitImportEx(db, { uid: UID, plan, resolutions: { [down.idx]: down.existing!.id, [status.idx]: 'skip' }, summary: null, projects: [] })
    expect(stored(db).find((p) => p.id === 'h1')!.earningsCents).toBe(8500)
    expect(stored(db).find((p) => p.id === 'h6')!.status).toBe('paid')
  })

  it('flags changed twin incentives as ambiguous instead of guessing', async () => {
    const db = await seeded()
    const changed = ALL.map((r) => (r === R.draftInc1 ? { ...r, earned: '$130.00' } : r === R.draftInc2 ? { ...r, earned: '$220.00' } : r))
    const { plan } = { plan: planImport(stored(db), parseDashboardText(page(changed), { now: NOW }), DEFAULT_SETTINGS, rev(db)) }
    expect(plan.items.filter((i) => i.kind === 'ambiguous')).toHaveLength(2)
  })

  it('keeps a third identical incentive as a separate new payment (multiset)', async () => {
    const db = await seeded()
    const { plan } = await sync(db, page([...ALL, R.draftInc1]))
    expect(kinds(plan)).toEqual({ update: 2, unchanged: 6, new: 1 })
    expect(stored(db).filter((p) => p.contract === 'Drafter' && p.type === 'incentive')).toHaveLength(3)
  })

  it('preserves manual notes, corrected rates, work dates and allocations', async () => {
    const db = await seeded()
    const h6 = stored(db).find((p) => p.id === 'h6')!
    await savePayment(db, UID, { ...h6, rateCents: 6600, allocation: [{ month: '2026-11', cents: 32500 }] })
    await sync(db, page(ALL.map((r) => (r === R.agentHrs ? { ...r, hours: '5.10', earned: '$331.50' } : r))))
    const after = stored(db).find((p) => p.id === 'h6')!
    expect(after).toMatchObject({ notes: 'my note', rateCents: 6600, workStart: '2026-11-07', earningsCents: 33150, hours: 5.1 })
    expect(after.allocation).toEqual([{ month: '2026-11', cents: 32500 }]) // kept; ignored by calc until it adds up
  })

  it('saves summary/project-only changes without payment writes or history', async () => {
    const db = await seeded()
    await sync(db, page(ALL))
    const { res } = await sync(db, page(ALL, { chart: '$7,080.00', projects: [{ name: 'Alpha', total: '$4,010.00', active: true }, { name: 'Beta', total: '$3,075.04', active: false }] }))
    expect(res).toMatchObject({ metaOnly: true, record: null })
    const meta = db.docs.get(`users/${UID}/meta/sync`)!.data
    expect((meta.summary as { chartTotalCents: number }).chartTotalCents).toBe(708000)
    expect(db.list(`users/${UID}/imports/`)).toHaveLength(1)
  })

  it('keeps inconsistent dashboard totals as separate values and does not alter records', async () => {
    const db = await seeded()
    const { plan, parsed } = await sync(db, page(ALL, { chart: '$7,076.79' }))
    const chart = plan.reconciliation.find((l) => l.label.includes('chart'))!
    expect(chart.diffCents).toBe(-825)
    expect(parsed.summary.lifetimeCents).toBe(708504)
    expect(lifetimeTotals(stored(db)).totalCents).toBe(lifetimeTotals(finalState(history(), plan, {})).totalCents)
  })

  it('rejects a concurrent import made from the same preview', async () => {
    const db = await seeded()
    const parsed = parseDashboardText(page(ALL), { now: NOW })
    const a = planImport(stored(db), parsed, DEFAULT_SETTINGS, rev(db))
    const b = planImport(stored(db), parsed, DEFAULT_SETTINGS, rev(db))
    const out = await Promise.allSettled([
      commitImportEx(db, { uid: UID, plan: a, resolutions: {}, summary: null, projects: [] }),
      commitImportEx(db, { uid: UID, plan: b, resolutions: {}, summary: null, projects: [] }),
    ])
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    expect((out.find((o) => o.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError)
    expect(stored(db)).toHaveLength(10)
  })

  it('creates clean records on a fresh account using dashboard names', async () => {
    const db = new MemoryDb()
    const { plan } = await sync(db, page(ALL))
    expect(kinds(plan)).toEqual({ new: 8 })
    expect(stored(db).some((p) => p.contract === LONG)).toBe(true)
    const { plan: again } = await sync(db, page(ALL))
    expect(kinds(again)).toEqual({ unchanged: 8 })
  })
})

describe('summary persistence', () => {
  it('keeps earlier summary values when a partial paste omits some cards', async () => {
    const db = await seeded()
    await sync(db, page(ALL))
    const partial = ['Total earnings to date$7,100.00', 'Payout date', 'Contract', 'Type', 'Status', 'Hours', 'Earned', row({ ...R.draftCur, hours: '2.18', earned: '$184.96' })].join('\n')
    await sync(db, partial)
    const s = db.docs.get(`users/${UID}/meta/sync`)!.data.summary as Record<string, unknown>
    expect(s).toMatchObject({ lifetimeCents: 710000, currentPayoutCents: 0, nextPayoutCents: 5, paidThisMonthCents: 10000, payoutCount: 3 })
  })
})

describe('one-cell-per-line copies (root cause of summary-only syncs)', () => {
  const cellsPage = (rows: Row[], extra: Partial<Parameters<typeof dashboard>[0]> = {}) =>
    dashboardCells({ lifetime: LIFE, rows, projects: [{ name: 'Alpha', total: '$4,000.00', active: true }, { name: 'Beta', total: '$3,085.04', active: false }], ...extra })

  it('parses every row, the summary and the projects', () => {
    const a = parseDashboardText(page(ALL), { now: NOW })
    const b = parseDashboardText(cellsPage(ALL), { now: NOW })
    const strip = (r: typeof a) => r.payments.map(({ raw: _raw, ...p }) => { void _raw; return p })
    expect(strip(b)).toEqual(strip(a))
    expect(b.projects).toEqual(a.projects)
    expect(b.summary).toMatchObject({ lifetimeCents: 708504, chartTotalCents: 708504, nextPayoutCents: 5, paidThisMonthCents: 10000, payoutCount: 3 })
    expect(b.warnings).toEqual([])
  })

  it('updates the stored payment records (not only the summary)', async () => {
    const db = await seeded()
    const { plan, res } = await sync(db, cellsPage(ALL))
    expect(kinds(plan)).toEqual({ update: 2, unchanged: 6 })
    expect(res.metaOnly).toBe(false)
    expect(stored(db).find((p) => p.id === 'h2')).toMatchObject({ hours: 30, earningsCents: 255000 })
    const meta = db.docs.get(`users/${UID}/meta/sync`)!.data
    expect(meta.projects).toHaveLength(2)
  })

  it('handles a release label split from its date', () => {
    const t = cellsPage([R.agentInc]).replace('Sent Nov 18, 2026', 'Sent\nNov 18, 2026')
    expect(parseDashboardText(t, { now: NOW }).payments[0]).toMatchObject({ earningsCents: 30000, releaseDate: '2026-11-18' })
  })
})

describe('unfamiliar and unreadable rows', () => {
  for (const layout of ['one line per row', 'one cell per line'] as const) {
    it(`${layout}: imports an unfamiliar payment type as Other with a notice`, async () => {
      const rows = [R.draftCur, { ...R.draftCur, type: 'Quality Review', hours: '1.00', earned: '$50.00' }]
      const t = layout === 'one line per row' ? dashboard({ lifetime: '$220.00', rows }) : dashboardCells({ lifetime: '$220.00', rows })
      const r = parseDashboardText(t, { now: NOW })
      expect(r.unparsedLines).toEqual([])
      expect(r.payments[1]).toMatchObject({ contract: 'Drafter', type: 'other', typeLabel: 'Quality Review', earningsCents: 5000, payoutDate: '2026-12-02', status: 'pending', unknownType: true })
      expect(r.warnings.join(' ')).toMatch(/does not know yet.*Quality Review/)
      // Repeated pastes stay idempotent
      const db = new MemoryDb()
      await sync(db, t)
      expect(kinds((await sync(db, t)).plan)).toEqual({ unchanged: 2 })
    })
  }

  it('lists a row with no status or amount with the reason and blocks it', () => {
    const t = [
      'Total earnings to date$175.00', 'Payout date', 'Contract', 'Type', 'Status', 'Hours', 'Earned',
      row(R.draftCur),
      'Dec 2, 2026DrafterContracts (Nov 21 - Nov 27)SomethingElse3.00$5.00',
      'Ask Maven',
    ].join('\n')
    const r = parseDashboardText(t, { now: NOW })
    expect(r.payments).toHaveLength(1)
    expect(r.unparsedLines).toHaveLength(1)
    expect(r.unparsedLines[0]).toMatch(/SomethingElse.*unknown status/)
  })
})

describe('genuinely new rows mixed with existing ones', () => {
  const newWeek: Row = { payout: 'Dec 9, 2026', contract: 'Drafter', type: 'Contracts (Nov 28 - Dec 4)', status: 'Upcoming', release: 'Releases Dec 9, 2026', hours: '6.00', earned: '$510.00' }
  const newContract: Row = { payout: 'Dec 9, 2026', contract: 'Zeta Review', type: 'Contracts (Nov 28 - Dec 4)', status: 'Upcoming', release: 'Releases Dec 9, 2026', hours: '3.00', earned: '$195.00' }
  const newIncentive: Row = { payout: 'Dec 2, 2026', contract: 'Drafter', type: 'Incentive', status: 'Upcoming', release: 'Releases Dec 2, 2026', hours: '-', earned: '$75.00' }
  const grown = { ...R.seniorCur, hours: '31.00', earned: '$2,635.00' }
  const rows = [newWeek, grown, R.draftCur, newContract, newIncentive, R.draftPrev, R.leadTiny, R.agentInc, R.agentHrs, R.draftInc1, R.draftInc2]

  for (const layout of ['one line per row', 'one cell per line'] as const) {
    for (const order of ['as shown', 'reversed'] as const) {
      it(`${layout}, ${order}: adds new rows, updates changed ones, no duplicates`, async () => {
        const db = await seeded()
        await sync(db, page(ALL)) // bring history up to date first
        const rs = order === 'reversed' ? [...rows].reverse() : rows
        const text = layout === 'one line per row' ? page(rs) : dashboardCells({ lifetime: LIFE, rows: rs })
        const { plan, res } = await sync(db, text)
        expect(kinds(plan)).toEqual({ new: 3, update: 1, unchanged: 7 })
        expect(res.record!.counts).toMatchObject({ created: 3, updated: 1 })
        const s = stored(db)
        expect(s).toHaveLength(13)
        expect(s.filter((p) => p.contract === 'Zeta Review')).toHaveLength(1)
        expect(s.find((p) => p.workStart === '2026-11-28' && p.contract === 'Drafter')).toMatchObject({ earningsCents: 51000, hours: 6, rateCents: 8500 })
        expect(s.filter((p) => p.contract === 'Drafter' && p.type === 'incentive')).toHaveLength(3)
        expect(s.find((p) => p.id === 'h2')).toMatchObject({ hours: 31, earningsCents: 263500 })
        // The same paste again changes nothing
        const again = await sync(db, text)
        expect(kinds(again.plan)).toEqual({ unchanged: 11 })
        expect(stored(db)).toHaveLength(13)
      })
    }
  }
})

describe('older snapshots never regress saved totals', () => {
  it('keeps the newer the dashboard summary and project totals when an older page is pasted', async () => {
    const db = await seeded()
    await sync(db, page(ALL, { lifetime: '$7,085.04', projects: [{ name: 'Alpha', total: '$4,000.00', active: true }] }))
    const older = page([R.draftCur], { lifetime: '$6,900.00', projects: [{ name: 'Alpha', total: '$3,800.00', active: true }] })
    const parsed = parseDashboardText(older, { now: NOW })
    const plan = planImport(stored(db), parsed, DEFAULT_SETTINGS, rev(db))
    const res = await commitImportEx(db, { uid: UID, plan, resolutions: {}, summary: parsed.summary, projects: parsed.projects })
    expect(res.noop).toBe(true)
    const meta = db.docs.get(`users/${UID}/meta/sync`)!.data as { summary: { lifetimeCents: number }; projects: { earningsCents: number }[] }
    expect(meta.summary.lifetimeCents).toBe(708504)
    expect(meta.projects[0].earningsCents).toBe(400000)
  })
})

describe('undo is a full revert', () => {
  it('restores payments AND the dashboard totals/projects saved by that import', async () => {
    const { undoImport } = await import('./store')
    const db = await seeded()
    const first = await sync(db, page(ALL, { lifetime: '$7,085.04' }))
    const metaAfterFirst = JSON.parse(JSON.stringify(db.docs.get(`users/${UID}/meta/sync`)!.data))
    const grown = ALL.map((r) => (r === R.draftCur ? { ...r, hours: '3.00', earned: '$255.00' } : r))
    const second = await sync(db, page(grown, { lifetime: '$7,170.04', projects: [{ name: 'Alpha', total: '$4,085.00', active: true }] }))
    expect(second.res.record).not.toBeNull()
    await undoImport(db, UID, second.res.record!.id)
    const meta = db.docs.get(`users/${UID}/meta/sync`)!.data as Record<string, unknown>
    expect((meta.summary as { lifetimeCents: number }).lifetimeCents).toBe(708504)
    expect(meta.projects).toEqual(metaAfterFirst.projects)
    expect(meta.lastSyncAt).toBe(metaAfterFirst.lastSyncAt)
    expect(stored(db).find((p) => p.id === 'h1')!.earningsCents).toBe(17000)
    void first
  })
})
