// Runs only on the owner's machine: verifies the parser against the real copied
// earnings dashboard kept in the git-ignored private/ folder. Skipped in CI.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDashboardText } from './parser'

const FILE = resolve(import.meta.dirname, '../../private/dashboard-sample-2026-11-25.txt')

describe.runIf(existsSync(FILE))('real dashboard sample (private, local only)', () => {
  const r = parseDashboardText(existsSync(FILE) ? readFileSync(FILE, 'utf8') : '', { now: new Date('2026-11-25T18:00:00Z') })
  it('parses every row and summary card', () => {
    if (process.env.SHOW_SAMPLE) {
      console.log(JSON.stringify(r.summary), JSON.stringify(r.projects), r.warnings)
      for (const p of r.payments) console.log(p.payoutDate, '|', p.contract, '|', p.type, p.workStart, p.workEnd, p.hours, p.earningsCents, p.status, p.releaseDate, p.releaseKind, '|', p.releaseText)
    }
    expect(r.payments).toHaveLength(10)
    expect(r.warnings).toEqual([])
    expect(r.projects).toHaveLength(4)
    expect(r.summary.lifetimeCents).not.toBeNull()
    expect(r.summary.chartTotalCents).not.toBeNull()
    expect(r.summary.lifetimeCents).not.toBe(r.summary.chartTotalCents)
  })
})

const PAGE2 = resolve(import.meta.dirname, '../../private/paste-page2-2026-11-25.txt')

describe.runIf(existsSync(FILE) && existsSync(PAGE2))('real two-page paste (private, local only)', () => {
  it('reads the rows of both pages pasted together, in either order', () => {
    const a = readFileSync(FILE, 'utf8')
    const b = readFileSync(PAGE2, 'utf8')
    const now = { now: new Date('2026-11-25T18:00:00Z') }
    const one = parseDashboardText(a, now).payments.length + parseDashboardText(b, now).payments.length
    expect(parseDashboardText(a + '\n' + b, now).payments).toHaveLength(one)
    expect(parseDashboardText(b + '\n' + a, now).payments).toHaveLength(one)
    expect(parseDashboardText(a + '\n' + b + '\n' + b, now).payments).toHaveLength(one)
  })
})

const BACKUP = resolve(import.meta.dirname, '../../private/sheet-backup.json')

describe.runIf(existsSync(FILE) && existsSync(BACKUP))('real backup + real dashboard paste (private, local only)', () => {
  it('updates existing records without duplicates and reconciles with the dashboard total', async () => {
    const { MemoryDb, restoreBackup, validateBackup, commitImportEx } = await import('./store')
    const { planImport, finalState } = await import('./sync')
    const { lifetimeTotals } = await import('./calc')
    const { DEFAULT_SETTINGS } = await import('./types')
    const db = new MemoryDb()
    const uid = 'me'
    await restoreBackup(db, uid, validateBackup(JSON.parse(readFileSync(BACKUP, 'utf8'))))
    const list = () => db.list(`users/${uid}/payments/`) as unknown as import('./types').Payment[]
    const parsed = parseDashboardText(readFileSync(FILE, 'utf8'), { now: new Date('2026-11-25T18:00:00Z') })
    const plan = planImport(list(), parsed, DEFAULT_SETTINGS, 1)
    const counts = plan.items.reduce<Record<string, number>>((a, i) => ({ ...a, [i.kind]: (a[i.kind] ?? 0) + 1 }), {})
    const after = lifetimeTotals(finalState(list(), plan, {}))
    if (process.env.SHOW_SAMPLE) {
      console.log(counts, 'kept', plan.preserved, 'total', after.totalCents, 'paid', after.paidCents, 'pending', after.pendingCents, 'hours', after.hours.toFixed(2))
      for (const it of plan.items) console.log(it.kind, it.existing?.contract ?? it.incoming.contract, it.incoming.workStart, it.incoming.earningsCents, it.changes.map((c) => `${c.field}:${c.from}->${c.to}`).join(' '), it.alias?.from ?? '')
      console.log(plan.reconciliation.map((l) => `${l.label}: ${l.diffCents}`))
    }
    expect(counts.new ?? 0).toBe(0)
    expect(counts.ambiguous ?? 0).toBe(0)
    expect(counts.conflict ?? 0).toBe(0)
    expect(plan.preserved).toBe(6)
    expect(after.totalCents).toBe(parsed.summary.lifetimeCents)
    await commitImportEx(db, { uid, plan, resolutions: {}, summary: parsed.summary, projects: parsed.projects })
    expect(list()).toHaveLength(16)
    // Second paste of the same text is a no-op
    const again = planImport(list(), parsed, DEFAULT_SETTINGS, 2)
    expect(again.items.every((i) => i.kind === 'unchanged')).toBe(true)
  })
})

const SNAP = resolve(import.meta.dirname, '../../private/firestore-snapshot.json')

/** Re-render the real one-line-per-row sample as one cell per line (other browsers). */
function toCells(text: string): string {
  return text
    .split('\n')
    .flatMap((l) => {
      const m = l.match(/^(\w{3} \d{1,2}, \d{4})(.+?)(Contracts \([^)]*\)|Incentive)(Upcoming|Released|Paid)(Releases today \(PST\)|(?:Releases|Released|Sent) \w{3} \d{1,2}, \d{4})(-|\d+\.\d+)(\$[\d,.]+)$/)
      if (m) return m.slice(1)
      const t = l.match(/^(Total earnings to date)(\$[\d,.]+)$/) ?? l.match(/^(\$[\d,.]+)(Total earnings)$/)
      return t ? t.slice(1) : [l]
    })
    .join('\n')
}

describe.runIf(existsSync(FILE) && existsSync(SNAP))('real Firestore records + real paste (private, local only)', () => {
  for (const layout of ['one line per row', 'one cell per line'] as const) {
    it(`syncs payment records from the ${layout} layout`, async () => {
      const { planImport, finalState } = await import('./sync')
      const { lifetimeTotals } = await import('./calc')
      const { DEFAULT_SETTINGS } = await import('./types')
      const existing = JSON.parse(readFileSync(SNAP, 'utf8'))
      const raw = readFileSync(FILE, 'utf8')
      const parsed = parseDashboardText(layout === 'one line per row' ? raw : toCells(raw), { now: new Date('2026-11-25T18:00:00Z') })
      expect(parsed.payments).toHaveLength(10)
      expect(parsed.projects).toHaveLength(4)
      const plan = planImport(existing, parsed, DEFAULT_SETTINGS, 3)
      const counts = plan.items.reduce<Record<string, number>>((a, i) => ({ ...a, [i.kind]: (a[i.kind] ?? 0) + 1 }), {})
      const after = lifetimeTotals(finalState(existing, plan, {}))
      if (process.env.SHOW_SAMPLE) {
        console.log(layout, counts, 'kept', plan.preserved, 'total', after.totalCents)
        for (const it of plan.items.filter((i) => i.kind !== 'unchanged')) console.log(' ', it.kind, it.existing?.id, it.existing?.contract ?? it.incoming.contract, it.changes.map((c) => `${c.field}:${c.from}->${c.to}`).join(' '), it.reason ?? '')
      }
      expect(counts.new ?? 0).toBe(0)
      expect(plan.items.filter((i) => i.kind === 'ambiguous' || i.kind === 'conflict')).toHaveLength(0)
      expect(after.totalCents).toBe(parsed.summary.lifetimeCents)
    })
  }
})

describe.runIf(existsSync(FILE) && existsSync(SNAP))('real project mapping (private, local only)', () => {
  it('learns all four project mappings after the sync', async () => {
    const { planImport, finalState } = await import('./sync')
    const { inferProjectMap } = await import('./projects')
    const { DEFAULT_SETTINGS } = await import('./types')
    const existing = JSON.parse(readFileSync(SNAP, 'utf8'))
    const parsed = parseDashboardText(readFileSync(FILE, 'utf8'), { now: new Date('2026-11-25T18:00:00Z') })
    const final = finalState(existing, planImport(existing, parsed, DEFAULT_SETTINGS, 3), {})
    const map = inferProjectMap(parsed.projects, final)
    if (process.env.SHOW_SAMPLE) console.log(map)
    expect(Object.keys(map)).toHaveLength(4)
  })
})
