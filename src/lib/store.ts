// Storage operations, written against a tiny transactional interface so the same
// logic runs on Firestore in production and on an in-memory DB in tests.
// Every mutation bumps users/{uid}/meta/sync.revision inside the same
// transaction; imports refuse to commit if the revision moved since preview.

import type { ImportRecord, ParsedProject, ParsedSummary, Payment, Settings, SyncMeta } from './types'
import { applyPlan, isStaleProjects, isStaleSummary, validateResolutions, type ImportPlan, type Resolution } from './sync'

export type DocData = Record<string, unknown>

export interface Tx {
  get(path: string): Promise<DocData | null>
  set(path: string, data: DocData): void
  delete(path: string): void
}

export interface Db {
  newId(): string
  runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}

export class ConflictError extends Error {
  constructor(message = 'Your data changed since this preview was created (another tab or device). Re-run the preview and try again.') {
    super(message)
    this.name = 'ConflictError'
  }
}

export const paths = {
  user: (uid: string) => `users/${uid}`,
  payment: (uid: string, id: string) => `users/${uid}/payments/${id}`,
  importDoc: (uid: string, id: string) => `users/${uid}/imports/${id}`,
  sync: (uid: string) => `users/${uid}/meta/sync`,
}

export function emptyMeta(): SyncMeta {
  return { revision: 0, lastSyncAt: null, lastImportId: null, summary: null, projects: [] }
}

async function readMeta(tx: Tx, uid: string): Promise<SyncMeta> {
  const d = await tx.get(paths.sync(uid))
  return d ? ({ ...emptyMeta(), ...(d as Partial<SyncMeta>) } as SyncMeta) : emptyMeta()
}

function stripId(p: Payment): DocData {
  const rest: Record<string, unknown> = { ...p }
  delete rest.id
  return clean(rest)
}

/** Firestore rejects `undefined`; drop such keys recursively. */
export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) if (val !== undefined) out[k] = clean(val)
    return out as T
  }
  return v
}

// ---------------------------------------------------------------- import

export interface CommitImportArgs {
  uid: string
  plan: ImportPlan
  resolutions: Record<number, Resolution>
  summary: ParsedSummary | null
  projects: ParsedProject[]
  now?: number
  /** Tracked totals before/after (cents) for history and "+$x since last import" */
  totals?: { before: number; after: number }
  /** Learned project → contracts mapping to persist */
  projectMap?: Record<string, string[]>
}

export interface CommitResult {
  /** null when no payment changed (no history entry is written) */
  record: ImportRecord | null
  /** true when only the dashboard summary / projects were saved */
  metaOnly: boolean
  /** true when nothing at all needed saving */
  noop: boolean
}

/** Keep previously saved summary values for cards missing from a partial paste. */
export function mergeSummary(prev: ParsedSummary | null, next: ParsedSummary | null): ParsedSummary | null {
  if (!next) return prev
  // Never let an older page (lower lifetime total) replace newer saved totals.
  if (isStaleSummary(prev, next)) return prev
  if (!prev) return next
  const out: Record<string, unknown> = { ...prev }
  for (const [k, v] of Object.entries(next)) if (v !== null && v !== undefined) out[k] = v
  return out as unknown as ParsedSummary
}

function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    if (!v || typeof v !== 'object') return JSON.stringify(v ?? null)
    const o = { ...(v as Record<string, unknown>) }
    delete o.importedAt
    return JSON.stringify(o, Object.keys(o).sort())
  }
  return norm(a) === norm(b)
}

/** Commit an import; see CommitResult. Throws ConflictError on stale previews. */
export async function commitImportEx(db: Db, args: CommitImportArgs): Promise<CommitResult> {
  const { uid, plan, resolutions } = args
  const err = validateResolutions(plan, resolutions)
  if (err) throw new Error(err)
  const now = args.now ?? Date.now()
  const probe = applyPlan(plan, resolutions, now, 'probe')
  if (probe.creates.length || probe.updates.length) {
    return { record: await commitImport(db, args), metaOnly: false, noop: false }
  }
  // No payment changes: save only changed summary/projects; never add history.
  return db.runTransaction(async (tx) => {
    const meta = await readMeta(tx, uid)
    if (meta.revision !== plan.baseRevision) throw new ConflictError()
    const merged = mergeSummary(meta.summary, args.summary)
    const summaryChanged = !!args.summary && (args.summary.lifetimeCents !== null || args.summary.chartTotalCents != null) && !sameJson(merged, meta.summary)
    const projectsChanged = args.projects.length > 0 && !isStaleProjects(meta.projects, args.projects) && JSON.stringify(args.projects) !== JSON.stringify(meta.projects)
    if (!summaryChanged && !projectsChanged) return { record: null, metaOnly: false, noop: true }
    tx.set(
      paths.sync(uid),
      clean({
        ...meta,
        // Payments were not changed: keep lastSyncAt, record the summary save separately.
        lastSummaryAt: now,
        projectMap: args.projectMap ?? meta.projectMap ?? {},
        summary: summaryChanged ? merged : meta.summary,
        projects: projectsChanged ? args.projects : meta.projects,
      }) as unknown as DocData,
    )
    return { record: null, metaOnly: true, noop: false }
  })
}

export async function commitImport(db: Db, args: CommitImportArgs): Promise<ImportRecord> {
  const { uid, plan, resolutions } = args
  const err = validateResolutions(plan, resolutions)
  if (err) throw new Error(err)
  const now = args.now ?? Date.now()
  const importId = db.newId()
  const out = applyPlan(plan, resolutions, now, importId)
  const createdIds = out.creates.map(() => db.newId())

  return db.runTransaction(async (tx) => {
    const meta = await readMeta(tx, uid)
    if (meta.revision !== plan.baseRevision) throw new ConflictError()
    // Guard against updating a payment that was deleted meanwhile.
    for (const u of out.updates) {
      const cur = await tx.get(paths.payment(uid, u.before.id))
      if (!cur || (cur.updatedAt as number) !== u.before.updatedAt) throw new ConflictError()
    }
    out.creates.forEach((c, i) => tx.set(paths.payment(uid, createdIds[i]), clean(c as DocData)))
    for (const u of out.updates) tx.set(paths.payment(uid, u.after.id), stripId(u.after))

    const record: ImportRecord = {
      id: importId,
      createdAt: now,
      createdIds,
      before: out.updates.map((u) => u.before),
      afterUpdatedAt: Object.fromEntries([
        ...createdIds.map((id) => [id, now] as const),
        ...out.updates.map((u) => [u.after.id, now] as const),
      ]),
      counts: out.counts,
      summary: args.summary,
      reconciliation: plan.reconciliation,
      undone: false,
      undoneAt: null,
      metaBefore: {
        summary: meta.summary ?? null,
        projects: meta.projects ?? [],
        projectMap: meta.projectMap ?? {},
        lastSyncAt: meta.lastSyncAt ?? null,
        lastSummaryAt: meta.lastSummaryAt ?? null,
      },
      revisionBefore: meta.revision,
      revisionAfter: meta.revision + 1,
      totalBeforeCents: args.totals?.before,
      totalAfterCents: args.totals?.after,
    }
    const rec = clean({ ...record }) as unknown as DocData
    delete rec.id
    tx.set(paths.importDoc(uid, importId), rec)
    tx.set(
      paths.sync(uid),
      clean({
        ...meta,
        revision: meta.revision + 1,
        lastSyncAt: now,
        lastSummaryAt: args.summary ? now : meta.lastSummaryAt ?? null,
        lastImportId: importId,
        projectMap: args.projectMap ?? meta.projectMap ?? {},
        summary: mergeSummary(meta.summary, args.summary),
        projects: args.projects.length && !isStaleProjects(meta.projects, args.projects) ? args.projects : meta.projects,
      }) as unknown as DocData,
    )
    return record
  })
}

export interface UndoResult {
  deleted: number
  restored: number
  skippedEdited: string[]
}

/**
 * Undo an import: delete payments it created and restore the previous state of
 * payments it updated. Payments edited after the import are left alone unless
 * `force` is set, and reported back.
 */
export async function undoImport(db: Db, uid: string, importId: string, force = false, now = Date.now()): Promise<UndoResult> {
  return db.runTransaction(async (tx) => {
    const meta = await readMeta(tx, uid)
    const recData = await tx.get(paths.importDoc(uid, importId))
    if (!recData) throw new Error('Import not found.')
    const rec = { ...(recData as unknown as ImportRecord), id: importId }
    if (rec.undone) throw new Error('This import was already undone.')

    const skippedEdited: string[] = []
    const ops: (() => void)[] = []
    let deleted = 0
    let restored = 0
    for (const id of rec.createdIds) {
      const cur = await tx.get(paths.payment(uid, id))
      if (!cur) continue
      if (!force && cur.updatedAt !== rec.afterUpdatedAt[id]) {
        skippedEdited.push(id)
        continue
      }
      ops.push(() => tx.delete(paths.payment(uid, id)))
      deleted++
    }
    for (const before of rec.before) {
      const cur = await tx.get(paths.payment(uid, before.id))
      if (cur && !force && cur.updatedAt !== rec.afterUpdatedAt[before.id]) {
        skippedEdited.push(before.id)
        continue
      }
      ops.push(() => tx.set(paths.payment(uid, before.id), stripId({ ...before, updatedAt: now })))
      restored++
    }
    if (skippedEdited.length && !force) {
      throw new EditedSinceImportError(skippedEdited)
    }
    ops.forEach((f) => f())
    tx.set(paths.importDoc(uid, importId), clean({ ...recData, undone: true, undoneAt: now }))
    // A full undo also puts back the dashboard totals, projects and sync times saved by this import.
    const back = rec.metaBefore && meta.lastImportId === importId
      ? { summary: rec.metaBefore.summary, projects: rec.metaBefore.projects, projectMap: rec.metaBefore.projectMap ?? meta.projectMap ?? {}, lastSyncAt: rec.metaBefore.lastSyncAt, lastSummaryAt: rec.metaBefore.lastSummaryAt ?? null, lastImportId: null }
      : {}
    tx.set(paths.sync(uid), clean({ ...meta, ...back, revision: meta.revision + 1 }) as unknown as DocData)
    return { deleted, restored, skippedEdited }
  })
}

export class EditedSinceImportError extends Error {
  ids: string[]
  constructor(ids: string[]) {
    super(`${ids.length} payment(s) were edited after this import. Undo anyway to overwrite those edits?`)
    this.name = 'EditedSinceImportError'
    this.ids = ids
  }
}

// ---------------------------------------------------------------- manual edits

export async function savePayment(
  db: Db,
  uid: string,
  data: Omit<Payment, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: number },
  now = Date.now(),
): Promise<string> {
  const id = data.id ?? db.newId()
  await db.runTransaction(async (tx) => {
    const meta = await readMeta(tx, uid)
    const existing = data.id ? await tx.get(paths.payment(uid, id)) : null
    const doc: Payment = {
      ...(data as Payment),
      id,
      createdAt: (existing?.createdAt as number | undefined) ?? data.createdAt ?? now,
      updatedAt: now,
    }
    tx.set(paths.payment(uid, id), stripId(doc))
    tx.set(paths.sync(uid), clean({ ...meta, revision: meta.revision + 1 }) as unknown as DocData)
  })
  return id
}

export async function deletePayments(db: Db, uid: string, ids: string[]): Promise<void> {
  await db.runTransaction(async (tx) => {
    const meta = await readMeta(tx, uid)
    for (const id of ids) tx.delete(paths.payment(uid, id))
    tx.set(paths.sync(uid), clean({ ...meta, revision: meta.revision + 1 }) as unknown as DocData)
  })
}

/** Accept (or with null, stop accepting) the current tracked-vs-dashboard difference. Payments are not changed. */
export async function setReconciliationAccepted(db: Db, uid: string, value: { trackedCents: number; reportedCents: number } | null, now = Date.now()) {
  await db.runTransaction(async (tx) => {
    const meta = await readMeta(tx, uid)
    tx.set(paths.sync(uid), clean({ ...meta, reconAccepted: value ? { ...value, at: now } : null }) as unknown as DocData)
  })
}

export async function saveSettings(db: Db, uid: string, settings: Settings & { email?: string | null }): Promise<void> {
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(paths.user(uid))) ?? {}
    tx.set(paths.user(uid), clean({ ...cur, ...settings, updatedAt: Date.now() }) as unknown as DocData)
  })
}

// ---------------------------------------------------------------- backup

export interface Backup {
  app: string
  version: 1
  exportedAt: string
  settings?: Partial<Settings>
  payments: Payment[]
  meta?: Partial<SyncMeta>
}

export function validateBackup(data: unknown): Backup {
  const b = data as Backup
  // New backups say "chaching"; older files said "rashio", "my-earnings" or "<name>-track" and still restore.
  if (!b || typeof b !== 'object' || typeof b.app !== 'string' || !(b.app === 'chaching' || b.app === 'rashio' || b.app === 'my-earnings' || /^[a-z]+-track$/.test(b.app)) || b.version !== 1 || !Array.isArray(b.payments)) {
    throw new Error('Not a ChaChing backup file (expected version 1 with a payments list).')
  }
  for (const p of b.payments) {
    if (typeof p.id !== 'string' || !p.id || /\//.test(p.id)) throw new Error('Backup contains a payment without a valid id.')
    if (typeof p.contract !== 'string' || !Number.isInteger(p.earningsCents)) {
      throw new Error(`Payment ${p.id} is missing contract or integer earningsCents.`)
    }
    if (!['hourly', 'incentive', 'work_trial', 'other'].includes(p.type)) throw new Error(`Payment ${p.id} has an invalid type.`)
    if (!['paid', 'pending', 'processing', 'failed', 'other'].includes(p.status)) {
      throw new Error(`Payment ${p.id} has an invalid status.`)
    }
  }
  return b
}

export interface RestoreResult {
  written: number
  skipped: number
}

/**
 * Restore backup payments into Firestore. Insert-only by default: a payment id
 * that already exists is skipped, so restoring an old backup can never revert
 * newer synced values or create duplicates. Never deletes anything.
 */
export async function restoreBackup(
  db: Db,
  uid: string,
  backup: Backup,
  opts: { overwrite?: boolean; now?: number } = {},
): Promise<RestoreResult> {
  const now = opts.now ?? Date.now()
  const chunk = 200
  let written = 0
  let skipped = 0
  for (let i = 0; i < backup.payments.length; i += chunk) {
    const part = backup.payments.slice(i, i + chunk)
    const res = await db.runTransaction(async (tx) => {
      const meta = await readMeta(tx, uid)
      const existing = await Promise.all(part.map((p) => tx.get(paths.payment(uid, p.id))))
      let w = 0
      let sk = 0
      part.forEach((p, j) => {
        if (existing[j] && !opts.overwrite) {
          sk++
          return
        }
        tx.set(
          paths.payment(uid, p.id),
          stripId({ ...p, source: p.source ?? 'manual', createdAt: p.createdAt ?? now, updatedAt: now }),
        )
        w++
      })
      if (w) tx.set(paths.sync(uid), clean({ ...meta, revision: meta.revision + 1 }) as unknown as DocData)
      return { w, sk }
    })
    written += res.w
    skipped += res.sk
  }
  return { written, skipped }
}

// ---------------------------------------------------------------- in-memory DB (tests)

export class MemoryDb implements Db {
  docs = new Map<string, { data: DocData; version: number }>()
  private counter = 0
  /** Optional hook to interleave concurrent transactions in tests */
  beforeCommit?: () => Promise<void>

  newId(): string {
    this.counter += 1
    return `id${String(this.counter).padStart(5, '0')}`
  }

  list(prefix: string): (DocData & { id: string })[] {
    const out: (DocData & { id: string })[] = []
    for (const [path, v] of this.docs) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
        out.push({ ...structuredClone(v.data), id: path.slice(prefix.length) })
      }
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : 1))
  }

  async runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reads = new Map<string, number>()
      const writes = new Map<string, DocData | null>()
      const tx: Tx = {
        get: async (path) => {
          await Promise.resolve()
          const d = this.docs.get(path)
          reads.set(path, d?.version ?? 0)
          if (writes.has(path)) return writes.get(path) ? structuredClone(writes.get(path)!) : null
          return d ? structuredClone(d.data) : null
        },
        set: (path, data) => void writes.set(path, structuredClone(data)),
        delete: (path) => void writes.set(path, null),
      }
      const result = await fn(tx)
      if (this.beforeCommit) await this.beforeCommit()
      const stale = [...reads].some(([p, v]) => (this.docs.get(p)?.version ?? 0) !== v)
      if (stale) continue // optimistic retry, like Firestore
      for (const [p, data] of writes) {
        if (data === null) this.docs.delete(p)
        else this.docs.set(p, { data, version: (this.docs.get(p)?.version ?? 0) + 1 })
      }
      return result
    }
    throw new Error('Transaction failed after retries')
  }
}
