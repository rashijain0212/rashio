// Firestore security-rules tests. Run with: npm run test:rules (needs Java for the emulator).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore'

let env: RulesTestEnvironment

const payment = {
  contract: 'Atlas Writer',
  type: 'hourly',
  earningsCents: 89250,
  status: 'pending',
  payoutDate: '2026-12-02',
  hours: 10.5,
  rateCents: 8500,
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-earnings',
    firestore: { rules: readFileSync(resolve(import.meta.dirname, '../../firestore.rules'), 'utf8') },
  })
})
afterAll(async () => env?.cleanup())
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/alice/payments/p1'), payment)
    await setDoc(doc(ctx.firestore(), 'users/alice'), { cycleStartDay: 21 })
  })
})

describe('authentication', () => {
  it('denies all unauthenticated access', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'users/alice/payments/p1')))
    await assertFails(getDoc(doc(db, 'users/alice')))
    await assertFails(setDoc(doc(db, 'users/alice/payments/p2'), payment))
    await assertFails(getDocs(collection(db, 'users/alice/payments')))
  })
})

describe('data isolation', () => {
  it('lets owners read and write their own data', async () => {
    const db = env.authenticatedContext('alice').firestore()
    await assertSucceeds(getDoc(doc(db, 'users/alice/payments/p1')))
    await assertSucceeds(getDocs(collection(db, 'users/alice/payments')))
    await assertSucceeds(setDoc(doc(db, 'users/alice/payments/p2'), payment))
    await assertSucceeds(updateDoc(doc(db, 'users/alice/payments/p1'), { status: 'paid' }))
    await assertSucceeds(setDoc(doc(db, 'users/alice/imports/i1'), { createdAt: 1, createdIds: [] }))
    await assertSucceeds(setDoc(doc(db, 'users/alice/meta/sync'), { revision: 1 }))
    await assertSucceeds(deleteDoc(doc(db, 'users/alice/payments/p1')))
  })

  it("blocks reading or writing another user's data", async () => {
    const db = env.authenticatedContext('mallory').firestore()
    await assertFails(getDoc(doc(db, 'users/alice/payments/p1')))
    await assertFails(getDocs(collection(db, 'users/alice/payments')))
    await assertFails(getDoc(doc(db, 'users/alice')))
    await assertFails(setDoc(doc(db, 'users/alice/payments/p9'), payment))
    await assertFails(updateDoc(doc(db, 'users/alice/payments/p1'), { earningsCents: 1 }))
    await assertFails(deleteDoc(doc(db, 'users/alice/payments/p1')))
    await assertFails(setDoc(doc(db, 'users/alice/meta/sync'), { revision: 99 }))
  })

  it('denies paths outside /users/{uid}', async () => {
    const db = env.authenticatedContext('alice').firestore()
    await assertFails(setDoc(doc(db, 'public/x'), { a: 1 }))
    await assertFails(getDoc(doc(db, 'users/alice/other/x')))
    await assertFails(setDoc(doc(db, 'users/alice/meta/hack'), { a: 1 }))
  })
})

describe('payment validation', () => {
  it('rejects malformed payments', async () => {
    const db = env.authenticatedContext('alice').firestore()
    const ref = doc(db, 'users/alice/payments/bad')
    await assertFails(setDoc(ref, { ...payment, earningsCents: 12.5 }))
    await assertFails(setDoc(ref, { ...payment, type: 'salary' }))
    await assertFails(setDoc(ref, { ...payment, status: 'stolen' }))
    await assertFails(setDoc(ref, { ...payment, contract: '' }))
    await assertFails(setDoc(ref, { type: 'hourly' }))
    await assertSucceeds(setDoc(ref, { ...payment, hours: null, rateCents: null, type: 'incentive' }))
  })
})

describe('app writes satisfy the rules (real transactions)', () => {
  it('imports, re-imports and undoes through Firestore as the owner', async () => {
    const { runTransaction, collection: col } = await import('firebase/firestore')
    const { parseDashboardText } = await import('../../src/lib/parser')
    const { planImport } = await import('../../src/lib/sync')
    const { commitImport, undoImport } = await import('../../src/lib/store')
    const { DEFAULT_SETTINGS } = await import('../../src/lib/types')
    const { PAGE_LINES, NOW } = await import('../../src/test/fixtures/sample')
    type Db = import('../../src/lib/store').Db
    type DocData = import('../../src/lib/store').DocData

    const fs = env.authenticatedContext('bob').firestore()
    const db: Db = {
      newId: () => doc(col(fs, '_ids')).id,
      runTransaction: (fn) =>
        runTransaction(fs, (t) =>
          fn({
            get: async (p) => {
              const s = await t.get(doc(fs, p))
              return s.exists() ? (s.data() as DocData) : null
            },
            set: (p, d) => void t.set(doc(fs, p), d),
            delete: (p) => void t.delete(doc(fs, p)),
          }),
        ),
    }
    const parsed = parseDashboardText(PAGE_LINES, { now: NOW })
    const plan = planImport([], parsed, DEFAULT_SETTINGS, 0)
    const rec = await commitImport(db, { uid: 'bob', plan, resolutions: {}, summary: parsed.summary, projects: parsed.projects })
    const snap = await getDocs(collection(fs, 'users/bob/payments'))
    if (snap.size !== 6) throw new Error(`expected 6 payments, got ${snap.size}`)
    // Another user cannot see them
    await assertFails(getDocs(collection(env.authenticatedContext('eve').firestore(), 'users/bob/payments')))
    await undoImport(db, 'bob', rec.id)
    const after = await getDocs(collection(fs, 'users/bob/payments'))
    if (after.size !== 0) throw new Error('undo failed')
  })

  it('restores a backup into Firestore once and syncs the real clipboard format on top', async () => {
    const { runTransaction, collection: col } = await import('firebase/firestore')
    const { parseDashboardText } = await import('../../src/lib/parser')
    const { planImport } = await import('../../src/lib/sync')
    const { commitImportEx, restoreBackup } = await import('../../src/lib/store')
    const { DEFAULT_SETTINGS } = await import('../../src/lib/types')
    const { dashboard, R } = await import('../../src/test/fixtures/dashboardFixture')
    type Db = import('../../src/lib/store').Db
    type DocData = import('../../src/lib/store').DocData
    type Payment = import('../../src/lib/types').Payment
    const fs = env.authenticatedContext('carol').firestore()
    const db: Db = {
      newId: () => doc(col(fs, '_ids')).id,
      runTransaction: (fn) =>
        runTransaction(fs, (t) =>
          fn({
            get: async (p) => {
              const s = await t.get(doc(fs, p))
              return s.exists() ? (s.data() as DocData) : null
            },
            set: (p, d) => void t.set(doc(fs, p), d),
            delete: (p) => void t.delete(doc(fs, p)),
          }),
        ),
    }
    const hist = [{ id: 'h1', contract: 'Drafter', type: 'hourly', workStart: '2026-11-21', workEnd: '2026-11-27', payoutDate: '2026-12-02', hours: 1.5, earningsCents: 12750, rateCents: 8500, status: 'pending', releaseDate: null, source: 'manual', createdAt: 1, updatedAt: 1 }]
    const r1 = await restoreBackup(db, 'carol', { app: 'rashio', version: 1, exportedAt: 'x', payments: hist as Payment[] })
    const r2 = await restoreBackup(db, 'carol', { app: 'rashio', version: 1, exportedAt: 'x', payments: hist as Payment[] })
    if (r1.written !== 1 || r2.skipped !== 1) throw new Error('restore not idempotent')
    const read = async () => (await getDocs(collection(fs, 'users/carol/payments'))).docs.map((d) => ({ ...(d.data() as Payment), id: d.id }))
    const meta = async () => ((await getDoc(doc(fs, 'users/carol/meta/sync'))).data()?.revision as number) ?? 0
    const parsed = parseDashboardText(dashboard({ lifetime: '$170.00', rows: [R.draftCur] }), { now: new Date('2026-11-25T18:00:00Z') })
    const plan = planImport(await read(), parsed, DEFAULT_SETTINGS, await meta())
    if (plan.items[0].kind !== 'update') throw new Error(`expected update, got ${plan.items[0].kind}`)
    await commitImportEx(db, { uid: 'carol', plan, resolutions: {}, summary: parsed.summary, projects: parsed.projects })
    const rows = await read()
    if (rows.length !== 1 || rows[0].id !== 'h1' || rows[0].earningsCents !== 17000) throw new Error('sync did not update the restored record')
    await assertFails(getDocs(collection(env.authenticatedContext('dave').firestore(), 'users/carol/payments')))
  })
})
