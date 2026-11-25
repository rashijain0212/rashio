// Synthetic data only.
import { describe, expect, it } from 'vitest'
import { parseDashboardText } from './parser'
import { planImport } from './sync'
import { commitImport, MemoryDb, restoreBackup, validateBackup, type Backup } from './store'
import { DEFAULT_SETTINGS, type Payment } from './types'
import { NOW, pageWith } from '../test/fixtures/sample'

const UID = 'u1'
const stored = (db: MemoryDb) => db.list(`users/${UID}/payments/`) as unknown as Payment[]
const rev = (db: MemoryDb) => (db.docs.get(`users/${UID}/meta/sync`)?.data.revision as number) ?? 0
async function sync(db: MemoryDb, rows: string[], summary = '') {
  const parsed = parseDashboardText(summary + pageWith(rows), { now: NOW })
  const plan = planImport(stored(db), parsed, DEFAULT_SETTINGS, rev(db))
  await commitImport(db, { uid: UID, plan, resolutions: {}, summary: parsed.summary, projects: parsed.projects })
  return plan
}

const backup: Backup = validateBackup({
  app: 'rashio',
  version: 1,
  exportedAt: '2026-11-25T00:00:00Z',
  payments: [
    { id: 'hist-1', contract: 'Vega SWE', type: 'hourly', workStart: '2026-11-21', workEnd: '2026-11-27', payoutDate: '2026-12-02', hours: 30.5, earningsCents: 259250, rateCents: 8500, status: 'pending', releaseDate: null, source: 'manual', createdAt: 1, updatedAt: 1 },
    { id: 'hist-2', contract: 'Atlas Writer', type: 'incentive', workStart: '2026-11-12', workEnd: '2026-11-12', payoutDate: '2026-11-19', hours: null, earningsCents: 21500, rateCents: null, status: 'paid', releaseDate: '2026-11-18', source: 'manual', createdAt: 1, updatedAt: 1 },
    { id: 'hist-3', contract: 'Atlas Writer', type: 'incentive', workStart: '2026-11-12', workEnd: '2026-11-12', payoutDate: '2026-11-19', hours: null, earningsCents: 12500, rateCents: null, status: 'paid', releaseDate: '2026-11-18', source: 'manual', createdAt: 1, updatedAt: 1 },
  ],
})

describe('one-time backup migration', () => {
  it('writes every record and is idempotent', async () => {
    const db = new MemoryDb()
    expect(await restoreBackup(db, UID, backup)).toEqual({ written: 3, skipped: 0 })
    expect(stored(db)).toHaveLength(3)
    expect(await restoreBackup(db, UID, backup)).toEqual({ written: 0, skipped: 3 })
    expect(stored(db)).toHaveLength(3)
  })

  it('never reverts newer synced values', async () => {
    const db = new MemoryDb()
    await restoreBackup(db, UID, backup)
    await sync(db, ['Dec 2, 2026\tVega SWE\tHourly\tNov 21 - Nov 27, 2026\t31.02\t$2,636.70\tPaid · Dec 2, 2026'])
    await restoreBackup(db, UID, backup)
    const p = stored(db).find((x) => x.id === 'hist-1')!
    expect(p).toMatchObject({ hours: 31.02, earningsCents: 263670, status: 'paid', releaseDate: '2026-12-02' })
  })

  it('rejects files that are not Rashio backups', () => {
    expect(() => validateBackup({ foo: 1 })).toThrow(/Not a Rashio backup/)
    expect(() => validateBackup({ ...backup, payments: [{ ...backup.payments[0], earningsCents: 1.5 }] })).toThrow(/integer/)
  })
})

describe('sync on top of migrated history', () => {
  it('updates hours and earnings of the same payment instead of adding one', async () => {
    const db = new MemoryDb()
    await restoreBackup(db, UID, backup)
    const plan = await sync(db, ['Dec 2, 2026\tVega SWE\tHourly\tNov 21 - Nov 27, 2026\t31.02\t$2,636.70\tUpcoming'])
    expect(plan.items[0].kind).toBe('update')
    expect(plan.items[0].existing!.id).toBe('hist-1')
    expect(stored(db)).toHaveLength(3)
    expect(stored(db).find((x) => x.id === 'hist-1')).toMatchObject({ hours: 31.02, earningsCents: 263670 })
  })

  it('marks Upcoming → Paid with the release date', async () => {
    const db = new MemoryDb()
    await restoreBackup(db, UID, backup)
    await sync(db, ['Dec 2, 2026\tVega SWE\tHourly\tNov 21 - Nov 27, 2026\t30.5\t$2,592.50\tPaid · Dec 2, 2026'])
    expect(stored(db).find((x) => x.id === 'hist-1')).toMatchObject({ status: 'paid', releaseDate: '2026-12-02', releaseKind: 'actual' })
  })

  it('keeps twin incentives separate and preserves records missing from the page', async () => {
    const db = new MemoryDb()
    await restoreBackup(db, UID, backup)
    const plan = await sync(db, [
      'Nov 19, 2026\tAtlas Writer\tIncentive\tNov 12, 2026\t\t$215.00\tPaid',
      'Nov 19, 2026\tAtlas Writer\tIncentive\tNov 12, 2026\t\t$125.00\tPaid',
    ])
    expect(plan.items.map((i) => i.kind)).toEqual(['unchanged', 'unchanged'])
    expect(stored(db)).toHaveLength(3)
    expect(stored(db).find((x) => x.id === 'hist-1')!.earningsCents).toBe(259250)
  })

  it('stores the latest dashboard summary, projects and last sync time', async () => {
    const db = new MemoryDb()
    await sync(db, ['Dec 2, 2026\tVega SWE\tHourly\tNov 21 - Nov 27, 2026\t2\t$170.00\tUpcoming'], 'Total earnings\t$170.00\nProjects\nVega\n$170.00\nActive\n')
    const meta = db.docs.get(`users/${UID}/meta/sync`)!.data
    expect(meta.summary).toMatchObject({ lifetimeCents: 17000 })
    expect(meta.projects).toEqual([{ name: 'Vega', earningsCents: 17000, active: true }])
    expect(typeof meta.lastSyncAt).toBe('number')
    expect(db.list(`users/${UID}/imports/`)).toHaveLength(1)
  })
})
