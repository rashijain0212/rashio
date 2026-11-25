import { describe, expect, it } from 'vitest'
import { parseDashboardText } from './parser'
import { planImport, applyPlan, identityKey, validateResolutions } from './sync'
import { commitImport, MemoryDb, undoImport, ConflictError, savePayment, EditedSinceImportError } from './store'
import { DEFAULT_SETTINGS, type Payment } from './types'
import { NOW, PAGE_LINES, pageWith } from '../test/fixtures/sample'

const UID = 'user-a'

function stored(db: MemoryDb): Payment[] {
  return db.list(`users/${UID}/payments/`) as unknown as Payment[]
}
function revision(db: MemoryDb): number {
  return (db.docs.get(`users/${UID}/meta/sync`)?.data.revision as number) ?? 0
}

async function importText(db: MemoryDb, text: string, resolutions: Record<number, string> = {}) {
  const parsed = parseDashboardText(text, { now: NOW })
  const plan = planImport(stored(db), parsed, DEFAULT_SETTINGS, revision(db))
  const rec = await commitImport(db, { uid: UID, plan, resolutions, summary: parsed.summary, projects: parsed.projects, now: 1000 + revision(db) })
  return { plan, rec }
}

describe('synchronisation', () => {
  it('creates records on first import', async () => {
    const db = new MemoryDb()
    const { plan } = await importText(db, PAGE_LINES)
    expect(plan.items.map((i) => i.kind)).toEqual(Array(6).fill('new'))
    expect(stored(db)).toHaveLength(6)
  })

  it('repeated identical imports never duplicate', async () => {
    const db = new MemoryDb()
    await importText(db, PAGE_LINES)
    for (let n = 0; n < 3; n++) {
      const { plan } = await importText(db, PAGE_LINES)
      expect(plan.items.every((i) => i.kind === 'unchanged')).toBe(true)
    }
    expect(stored(db)).toHaveLength(6)
  })

  it('updates changed hours, earnings and status in place', async () => {
    const db = new MemoryDb()
    await importText(db, PAGE_LINES)
    const changed = PAGE_LINES.replace('10.5 hrs\n$892.50\nUpcoming', '12 hrs\n$1,020.00\nPaid\nReleased Dec 2, 2026')
    const { plan } = await importText(db, changed)
    const upd = plan.items.filter((i) => i.kind === 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].changes.map((c) => c.field).sort()).toEqual(['earningsCents', 'hours', 'releaseDate', 'releaseKind', 'status'])
    const p = stored(db).find((x) => x.contract === 'Atlas Writer' && x.type === 'hourly')!
    expect(p).toMatchObject({ hours: 12, earningsCents: 102000, status: 'paid', releaseDate: '2026-12-02' })
    expect(stored(db)).toHaveLength(6)
  })

  it('handles a changed payout date for the same work', async () => {
    const db = new MemoryDb()
    await importText(db, pageWith(['Dec 2, 2026\tAtlas Writer\tHourly\tNov 21 - Nov 27, 2026\t10.5\t$892.50\tUpcoming']))
    const { plan } = await importText(db, pageWith(['Dec 3, 2026\tAtlas Writer\tHourly\tNov 21 - Nov 27, 2026\t10.5\t$892.50\tUpcoming']))
    expect(plan.items[0]).toMatchObject({ kind: 'update', reason: 'Payout date changed' })
    expect(stored(db)).toHaveLength(1)
    expect(stored(db)[0].payoutDate).toBe('2026-12-03')
  })

  it('keeps multiple incentives for the same contract and date separate', async () => {
    const db = new MemoryDb()
    const rows = [
      'Nov 25, 2026\tAtlas Writer\tIncentive\tNov 12, 2026\t\t$215.00\tPaid',
      'Nov 25, 2026\tAtlas Writer\tIncentive\tNov 12, 2026\t\t$125.00\tPaid',
    ]
    await importText(db, pageWith(rows))
    expect(stored(db)).toHaveLength(2)
    // Identical twin incentives are also legitimate
    const db2 = new MemoryDb()
    await importText(db2, pageWith([rows[0], rows[0]]))
    expect(stored(db2)).toHaveLength(2)
    const { plan } = await importText(db2, pageWith([rows[0], rows[0]]))
    expect(plan.items.map((i) => i.kind)).toEqual(['unchanged', 'unchanged'])
    // A third new incentive is added; the two existing ones match
    const { plan: p3 } = await importText(db, pageWith([...rows, 'Nov 25, 2026\tAtlas Writer\tIncentive\tNov 12, 2026\t\t$50.00\tPaid']))
    expect(p3.items.map((i) => i.kind)).toEqual(['unchanged', 'unchanged', 'new'])
    expect(stored(db)).toHaveLength(3)
  })

  it('flags ambiguous matches instead of overwriting', async () => {
    const db = new MemoryDb()
    const rows = (a: string, b: string) => [
      `Nov 25, 2026\tAtlas Writer\tIncentive\tNov 12, 2026\t\t${a}\tPaid`,
      `Nov 25, 2026\tAtlas Writer\tIncentive\tNov 12, 2026\t\t${b}\tPaid`,
    ]
    await importText(db, pageWith(rows('$215.00', '$125.00')))
    const parsed = parseDashboardText(pageWith(rows('$230.00', '$140.00')), { now: NOW })
    const plan = planImport(stored(db), parsed, DEFAULT_SETTINGS, revision(db))
    expect(plan.items.map((i) => i.kind)).toEqual(['ambiguous', 'ambiguous'])
    expect(plan.items[0].candidates).toHaveLength(2)
    // Cannot commit without resolving
    await expect(commitImport(db, { uid: UID, plan, resolutions: {}, summary: null, projects: [] })).rejects.toThrow(/ambiguous/)
    // Same target twice is rejected
    const [a, b] = stored(db)
    expect(validateResolutions(plan, { 0: a.id, 1: a.id })).toMatch(/more than one/)
    // Resolve: 230→215 record, 140→125 record
    const big = stored(db).find((p) => p.earningsCents === 21500)!
    const small = stored(db).find((p) => p.earningsCents === 12500)!
    void b
    await commitImport(db, { uid: UID, plan, resolutions: { 0: big.id, 1: small.id }, summary: null, projects: [] })
    expect(stored(db).map((p) => p.earningsCents).sort()).toEqual([14000, 23000])
  })

  it('partial-page imports preserve history', async () => {
    const db = new MemoryDb()
    await importText(db, PAGE_LINES)
    const { plan } = await importText(db, pageWith(['Dec 2, 2026\tAtlas Writer\tHourly\tNov 21 - Nov 27, 2026\t10.5\t$892.50\tPaid']))
    expect(plan.preserved).toBe(5)
    expect(stored(db)).toHaveLength(6)
    expect(stored(db).find((p) => p.earningsCents === 89250)!.status).toBe('paid')
  })

  it('identity ignores amounts and hours', () => {
    const base = { contract: 'Atlas  Writer', type: 'hourly', workStart: '2026-11-21', workEnd: '2026-11-27', payoutDate: '2026-12-02' }
    expect(identityKey(base)).toBe(identityKey({ ...base, contract: 'atlas writer', payoutDate: '2026-12-03' }))
  })

  it('does not assign hourly rates to incentives or trials, and snaps rounded hours', () => {
    const parsed = parseDashboardText(PAGE_LINES, { now: NOW })
    const plan = planImport([], parsed, DEFAULT_SETTINGS, 0)
    const out = applyPlan(plan, {}, 1, 'imp')
    const byContract = (c: string, t: string) => out.creates.find((p) => p.contract === c && p.type === t)!
    expect(byContract('Atlas Writer', 'hourly').rateCents).toBe(8500)
    expect(byContract('Orion Coding', 'hourly').rateCents).toBe(6500)
    expect(byContract('Atlas Writer', 'incentive').rateCents).toBeNull()
    expect(byContract('Atlas Writer', 'work_trial').rateCents).toBeNull()
  })

  it('matches a hand-split historical record by overlap and amount', async () => {
    const db = new MemoryDb()
    await savePayment(db, UID, {
      contract: 'Orion Coding', type: 'hourly', workStart: '2026-11-01', workEnd: '2026-11-06', payoutDate: '2026-11-18',
      hours: 12, earningsCents: 78000, rateCents: 6500, status: 'paid', releaseDate: '2026-11-17', source: 'manual',
    })
    const { plan } = await importText(db, pageWith(['Nov 18, 2026\tOrion Coding\tHourly\tOct 31 - Nov 6, 2026\t12\t$780.00\tPaid · Nov 17, 2026']))
    // Only fills in the missing release kind; amounts and the hand-entered period stay
    expect(plan.items[0]).toMatchObject({ kind: 'update', fuzzy: true })
    expect(plan.items[0].changes.map((c) => c.field)).toEqual(['releaseKind'])
    expect(stored(db)).toHaveLength(1)
    expect(stored(db)[0].workStart).toBe('2026-11-01')
  })
})

describe('reconciliation', () => {
  it('reports zero difference for a complete page', () => {
    const parsed = parseDashboardText(PAGE_LINES, { now: NOW })
    const plan = planImport([], parsed, DEFAULT_SETTINGS, 0)
    const life = plan.reconciliation.find((l) => l.label.includes('tracked total after sync'))!
    expect(life.diffCents).toBe(0)
    const proj = plan.reconciliation.find((l) => l.label.startsWith('Sum of project totals'))!
    expect(proj.diffCents).toBe(0)
  })
})

describe('import history, undo and concurrency', () => {
  it('undo removes created records and restores updated ones', async () => {
    const db = new MemoryDb()
    await importText(db, PAGE_LINES)
    const changed = PAGE_LINES.replace('$892.50\nUpcoming', '$892.50\nPaid')
    const { rec } = await importText(db, changed)
    expect(stored(db).find((p) => p.earningsCents === 89250)!.status).toBe('paid')
    const res = await undoImport(db, UID, rec.id)
    expect(res.restored).toBe(1)
    expect(stored(db).find((p) => p.earningsCents === 89250)!.status).toBe('pending')
    await expect(undoImport(db, UID, rec.id)).rejects.toThrow(/already undone/)
  })

  it('undo of a first import deletes its records', async () => {
    const db = new MemoryDb()
    const { rec } = await importText(db, PAGE_LINES)
    await undoImport(db, UID, rec.id)
    expect(stored(db)).toHaveLength(0)
  })

  it('undo refuses to overwrite later manual edits unless forced', async () => {
    const db = new MemoryDb()
    const { rec } = await importText(db, PAGE_LINES)
    const p = stored(db)[0]
    await savePayment(db, UID, { ...p, notes: 'edited' }, 999999)
    await expect(undoImport(db, UID, rec.id)).rejects.toBeInstanceOf(EditedSinceImportError)
    expect(stored(db)).toHaveLength(6)
    await undoImport(db, UID, rec.id, true)
    expect(stored(db)).toHaveLength(0)
  })

  it('concurrent imports: only one commits, the other gets a conflict', async () => {
    const db = new MemoryDb()
    const parsed = parseDashboardText(PAGE_LINES, { now: NOW })
    const planA = planImport([], parsed, DEFAULT_SETTINGS, 0)
    const planB = planImport([], parsed, DEFAULT_SETTINGS, 0)
    const results = await Promise.allSettled([
      commitImport(db, { uid: UID, plan: planA, resolutions: {}, summary: null, projects: [] }),
      commitImport(db, { uid: UID, plan: planB, resolutions: {}, summary: null, projects: [] }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(ConflictError)
    expect(stored(db)).toHaveLength(6)
  })

  it('a stale preview is rejected after another change', async () => {
    const db = new MemoryDb()
    const parsed = parseDashboardText(PAGE_LINES, { now: NOW })
    const plan = planImport([], parsed, DEFAULT_SETTINGS, 0)
    await savePayment(db, UID, {
      contract: 'X', type: 'other', workStart: null, workEnd: null, payoutDate: '2026-11-01', hours: null,
      earningsCents: 100, rateCents: null, status: 'paid', releaseDate: null, source: 'manual',
    })
    await expect(commitImport(db, { uid: UID, plan, resolutions: {}, summary: null, projects: [] })).rejects.toBeInstanceOf(ConflictError)
  })
})
