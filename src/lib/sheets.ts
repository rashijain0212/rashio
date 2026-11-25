// Google Sheets reporting copy. Firestore stays the source of truth; after each
// successful import the app rewrites the data parts of the user's spreadsheet:
//   • one tab per work month ("November 2026") with the payment rows,
//   • the Overview tab's monthly / 21st-to-21st / project sections,
//   • a raw "Earnings data" tab.
// Existing formulas, formatting and charts are preserved: rows are inserted or
// removed inside the data blocks, range formulas are re-pointed, and new month
// tabs are created by duplicating the latest month tab.

import type { ParsedProject, Payment } from './types'
import { cycleFor, daysInclusive, formatDate, monthKey, monthLabel, parseISO, toDayNumber } from './dates'
import { validAllocation } from './calc'

export type Cell = string | number
export type Grid = Cell[][]

export interface TabInfo {
  title: string
  sheetId: number
  index: number
}

/** Minimal surface of the Sheets API used by the sync (real client + in-memory fake). */
export interface SheetsApi {
  tabs(): Promise<TabInfo[]>
  /** Cell contents with formulas as written (FORMULA render), rows trimmed */
  read(title: string): Promise<Grid>
  batch(requests: object[]): Promise<{ replies?: { duplicateSheet?: { properties: TabInfo }; addSheet?: { properties: TabInfo } }[] }>
  /** RAW keeps text such as "Oct 24–30" literal; USER_ENTERED is used for formulas */
  write(data: { range: string; values: Grid }[], mode: 'RAW' | 'USER_ENTERED'): Promise<void>
  clear(range: string): Promise<void>
}

// ---------------------------------------------------------------- model

const MONTH_TAB_RE = /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const tabForMonth = (key: string) => monthLabel(key) // "November 2026"
export const shortForMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS_FULL[m - 1].slice(0, 3)} ${y}` // "Nov 2026"
}
export function monthKeyForTab(title: string): string | null {
  const m = title.match(MONTH_TAB_RE)
  if (!m) return null
  return `${m[2]}-${String(MONTHS_FULL.indexOf(m[1]) + 1).padStart(2, '0')}`
}

/** Google Sheets date serial (days since 1899-12-30). */
export function serial(iso: string | null | undefined): Cell {
  if (!iso) return ''
  return toDayNumber(iso) - toDayNumber('1899-12-30')
}

const money = (cents: number) => Math.round(cents) / 100

function workDate(p: Payment): string | null {
  return p.workEnd ?? p.workStart ?? p.payoutDate ?? p.releaseDate
}

function periodLabel(p: Payment): string {
  const kind = p.type === 'incentive' ? 'Incentive' : p.type === 'work_trial' ? 'Work Trial' : p.type === 'other' ? p.typeLabel || 'Other' : null
  if (kind) return `${kind} · ${formatDate(p.workStart ?? p.payoutDate, false)}`
  if (!p.workStart) return formatDate(p.payoutDate, false)
  if (!p.workEnd || p.workEnd === p.workStart) return formatDate(p.workStart, false)
  const a = parseISO(p.workStart)
  const b = parseISO(p.workEnd)
  return a.m === b.m ? `${formatDate(p.workStart, false)}–${b.d}` : `${formatDate(p.workStart, false)}–${formatDate(p.workEnd, false)}`
}

const sheetStatus = (p: Payment) => (p.status === 'paid' ? 'Paid' : p.status === 'failed' ? 'Failed' : 'Upcoming')

export interface SheetModel {
  months: { key: string; tab: string; short: string; rows: Grid }[]
  cycles: { label: string; values: number[] }[] // hours, hourly, incentives/trial, total, paid, pending
  projects: { name: string; earned: number }[]
  data: Grid
}

const DATA_HEADER = ['Payment ID', 'Work start', 'Work end', 'Contract', 'Dashboard contract name', 'Type', 'Hours', 'Rate / hr', 'Earned (USD)', 'Status', 'Payout date', 'Release date', 'Release text', 'Notes', 'Last updated']

export function buildSheetModel(payments: Payment[], projects: ParsedProject[], cycleStartDay = 21): SheetModel {
  const byMonth = new Map<string, { sort: string; row: Cell[] }[]>()
  const add = (key: string, sort: string, row: Cell[]) => byMonth.set(key, [...(byMonth.get(key) ?? []), { sort, row }])
  const rowFor = (p: Payment, earnedCents: number, hours: number | null, label: string): Cell[] => [
    label,
    p.contract,
    p.type === 'hourly' && hours !== null ? hours : '',
    p.type === 'hourly' && p.rateCents ? money(p.rateCents) : '',
    money(earnedCents),
    sheetStatus(p),
    serial(p.payoutDate),
    serial(p.releaseDate),
    serial(workDate(p)),
  ]
  for (const p of payments) {
    if (p.status === 'failed') continue
    const wd = workDate(p)
    if (!wd) continue
    const alloc = validAllocation(p)
    if (alloc && p.workStart && p.workEnd) {
      const totalDays = daysInclusive(p.workStart, p.workEnd)
      for (const a of alloc) {
        const hours = a.hours ?? (p.hours === null ? null : Math.round(((p.hours * a.cents) / (p.earningsCents || 1)) * 100) / 100)
        add(a.month, `${wd}|${p.contract}`, rowFor(p, a.cents, hours, `${periodLabel(p)} (${shortForMonth(a.month).slice(0, 3)} part)`))
      }
      void totalDays
    } else {
      add(monthKey(wd), `${wd}|${p.contract}|${p.id}`, rowFor(p, p.earningsCents, p.hours, periodLabel(p)))
    }
  }
  const months = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, rows]) => ({
      key,
      tab: tabForMonth(key),
      short: shortForMonth(key),
      rows: rows.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0)).map((r) => r.row),
    }))

  // 21st-to-21st cycles by work date (period end), end date exclusive in the label
  const cyc = new Map<string, { label: string; v: number[] }>()
  for (const p of payments) {
    if (p.status === 'failed') continue
    const wd = workDate(p)
    if (!wd) continue
    const c = cycleFor(wd, cycleStartDay)
    const nextStart = toDayNumber(c.end) + 1
    const endLabel = formatDate(new Date(nextStart * 86400000).toISOString().slice(0, 10), false)
    const entry = cyc.get(c.key) ?? { label: `${formatDate(c.start, false)} – ${endLabel}`, v: [0, 0, 0, 0, 0, 0] }
    if (p.type === 'hourly') {
      entry.v[0] += p.hours ?? 0
      entry.v[1] += p.earningsCents
    } else entry.v[2] += p.earningsCents
    entry.v[3] += p.earningsCents
    if (p.status === 'paid') entry.v[4] += p.earningsCents
    else entry.v[5] += p.earningsCents
    cyc.set(c.key, entry)
  }
  const cycles = [...cyc.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, e]) => ({ label: e.label, values: [Math.round(e.v[0] * 100) / 100, ...e.v.slice(1).map(money)] }))

  const data: Grid = [
    DATA_HEADER,
    ...[...payments]
      .sort((a, b) => ((workDate(a) ?? '') < (workDate(b) ?? '') ? -1 : 1))
      .map((p) => [
        p.id, serial(p.workStart), serial(p.workEnd), p.contract, p.sourceContract ?? '', p.typeLabel || p.type,
        p.hours ?? '', p.rateCents ? money(p.rateCents) : '', money(p.earningsCents), p.statusLabel || sheetStatus(p),
        serial(p.payoutDate), serial(p.releaseDate), p.releaseText ?? '', p.notes ?? '', new Date(p.updatedAt).toISOString(),
      ]),
  ]
  return {
    months,
    cycles,
    projects: projects.filter((p) => p.earningsCents !== null).map((p) => ({ name: p.name, earned: money(p.earningsCents!) })),
    data,
  }
}

// ---------------------------------------------------------------- helpers

const q = (title: string) => `'${title.replace(/'/g, "''")}'`
const colLetter = (i: number) => String.fromCharCode(65 + i)
const text = (c: Cell | undefined) => (c === undefined || c === null ? '' : String(c)).trim()

function findRow(grid: Grid, pred: (a: string) => boolean, from = 0): number {
  for (let i = from; i < grid.length; i++) if (pred(text(grid[i]?.[0]))) return i
  return -1
}

/**
 * Point every range that starts inside the data block (rows first..maxStart,
 * wherever inserts may have shifted it) at exactly first..last.
 */
export function repointRanges(formula: string, firstRow: number, lastRow: number, maxStart = lastRow): string {
  return formula.replace(/(\$?[A-Z]{1,2}\$?)(\d+):(\$?[A-Z]{1,2}\$?)(\d+)/g, (m, a, r1, b) => {
    const start = Number(r1)
    return start >= firstRow && start <= maxStart ? `${a}${firstRow}:${b}${lastRow}` : m
  })
}

/**
 * Resize the block of rows between a header row and its TOTAL row to `count`
 * rows (min 1), keeping formatting (rows are inserted inside the block).
 * Returns 1-based first/last data rows after resizing.
 */
async function resizeBlock(api: SheetsApi, tab: TabInfo, headerIdx: number, totalIdx: number, count: number) {
  const n = totalIdx - headerIdx - 1
  const m = Math.max(1, count)
  if (m > n) {
    await api.batch([
      {
        insertDimension: {
          range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: totalIdx - (n > 0 ? 1 : 0), endIndex: totalIdx - (n > 0 ? 1 : 0) + (m - n) },
          inheritFromBefore: n > 0,
        },
      },
    ])
  } else if (m < n) {
    await api.batch([{ deleteDimension: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: headerIdx + 1 + m, endIndex: totalIdx } } }])
  }
  return { first: headerIdx + 2, last: headerIdx + 1 + m, totalRow: headerIdx + 2 + m }
}

// ---------------------------------------------------------------- month tabs

function monthTemplate(short: string, rows: number): Grid {
  const L = 6 + Math.max(1, rows)
  const t = L + 1
  return [
    [`${short} | Work earnings`],
    ['Work period determines month; payout dates are retained for tracking.'],
    ['Earned', `=SUM(E7:E${L})`, 'Paid', `=SUMIF(F7:F${L},"Paid",E7:E${L})`, 'Pending', `=SUMIF(F7:F${L},"Upcoming",E7:E${L})`, 'Hours', `=SUM(C7:C${L})`],
    ['Hourly earnings', `=SUMIF(D7:D${L},">0",E7:E${L})`, 'Incentives / trial', '=B3-B4'],
    [],
    ['Work period', 'Contract', 'Hours', 'Rate / hr', 'Earned (USD)', 'Status', 'Payout date', 'Sent / release', 'Work date*'],
    ...Array.from({ length: Math.max(1, rows) }, () => []),
    ['TOTAL', '', `=SUM(C7:C${L})`, '', `=SUM(E7:E${L})`],
    [],
    ['Payment status', 'Paid', 'Pending'],
    [short, '=D3', '=F3'],
    [],
    ['Earnings type', 'Hourly', 'Incentives / trial'],
    [short, '=B4', '=D4'],
    [],
    ['*Work date = period end or recorded incentive/trial date; used for 21st-to-21st totals.'],
    ['Actual reported amounts used; hours are rounded. Written by ChaChing.'],
  ].map((r, i) => (i === t - 1 ? r : r))
}

async function ensureMonthTab(api: SheetsApi, tabs: TabInfo[], month: SheetModel['months'][number]): Promise<TabInfo> {
  const existing = tabs.find((t) => t.title === month.tab)
  if (existing) return existing
  const monthTabs = tabs.map((t) => ({ t, key: monthKeyForTab(t.title) })).filter((x) => x.key) as { t: TabInfo; key: string }[]
  // Template = closest earlier month tab (else the latest), so formatting/charts carry over.
  const earlier = monthTabs.filter((x) => x.key < month.key).sort((a, b) => (a.key < b.key ? 1 : -1))[0]
  const source = earlier ?? monthTabs.sort((a, b) => (a.key < b.key ? 1 : -1))[0]
  const insertAt = earlier ? earlier.t.index + 1 : source ? source.t.index : tabs.length
  if (source) {
    const res = await api.batch([{ duplicateSheet: { sourceSheetId: source.t.sheetId, insertSheetIndex: insertAt, newSheetName: month.tab } }])
    const info = res.replies?.[0]?.duplicateSheet?.properties ?? { title: month.tab, sheetId: -1, index: insertAt }
    // Relabel the copied month name in column A (title, status/type rows)
    const grid = await api.read(month.tab)
    const oldShort = shortForMonth(source.key)
    const fixes: { range: string; values: Grid }[] = []
    grid.forEach((r, i) => {
      const a = text(r[0])
      if (a.includes(oldShort)) fixes.push({ range: `${q(month.tab)}!A${i + 1}`, values: [[a.replace(oldShort, month.short)]] })
    })
    if (fixes.length) await api.write(fixes, 'RAW')
    return info
  }
  // No month tab at all: create one from the built-in template.
  const res = await api.batch([{ addSheet: { properties: { title: month.tab, index: insertAt } } }])
  const info = res.replies?.[0]?.addSheet?.properties ?? { title: month.tab, sheetId: -1, index: insertAt }
  const tpl = monthTemplate(month.short, month.rows.length)
  await api.write(tpl.map((r, i) => ({ range: `${q(month.tab)}!A${i + 1}`, values: [r.length ? r : ['']] })), 'USER_ENTERED')
  return info
}

async function writeMonthTab(api: SheetsApi, tab: TabInfo, month: SheetModel['months'][number]) {
  const grid = await api.read(tab.title)
  const h = findRow(grid, (a) => /^work period$/i.test(a))
  const tot = h >= 0 ? findRow(grid, (a) => /^total$/i.test(a), h + 1) : -1
  if (h < 0 || tot < 0) throw new Error(`Tab "${tab.title}" does not have a "Work period" header and a TOTAL row.`)
  const { first, last, totalRow } = await resizeBlock(api, tab, h, tot, month.rows.length)
  const width = 9
  const rows = month.rows.length ? month.rows : [Array(width).fill('')]
  await api.write([{ range: `${q(tab.title)}!A${first}:${colLetter(width - 1)}${last}`, values: rows.map((r) => [...r, ...Array(width - r.length).fill('')]) }], 'RAW')
  // Re-point range formulas above the block and in the TOTAL row.
  const formulas: { range: string; values: Grid }[] = []
  const after = await api.read(tab.title)
  const scan = [...Array(h).keys(), totalRow - 1]
  for (const i of scan) {
    ;(after[i] ?? []).forEach((c, j) => {
      if (typeof c === 'string' && c.startsWith('=')) {
        const f = repointRanges(c, first, last, totalRow - 1)
        if (f !== c) formulas.push({ range: `${q(tab.title)}!${colLetter(j)}${i + 1}`, values: [[f]] })
      }
    })
  }
  if (formulas.length) await api.write(formulas, 'USER_ENTERED')
}

// ---------------------------------------------------------------- overview

const OVERVIEW = 'Overview'

function overviewTemplate(): Grid {
  return [
    ['Earnings overview'],
    ['Grouped by work period, not payout date · USD · written by ChaChing.'],
    ['Total earned', '=E10', 'Paid', '=F10', 'Pending', '=G10'],
    ['Hours', '=B10', 'Hourly pay', '=C10', 'Incentives / trial', '=D10'],
    [],
    ['MONTHLY EARNINGS'],
    ['Period', 'Hours', 'Hourly pay', 'Incentives / trial', 'Total earned', 'Paid', 'Pending'],
    [],
    [],
    ['TOTAL'],
    [],
    ['21ST-TO-21ST WORK CYCLES'],
    ['Period', 'Hours', 'Hourly pay', 'Incentives / trial', 'Total earned', 'Paid', 'Pending'],
    [],
    ['TOTAL'],
    [],
    ['PROJECT EARNINGS | dashboard snapshot'],
    ['Project', 'Earned'],
    [],
    ['TOTAL'],
  ]
}

async function ensureOverview(api: SheetsApi, tabs: TabInfo[]): Promise<TabInfo> {
  const t = tabs.find((x) => x.title === OVERVIEW)
  if (t) {
    // An empty Overview (e.g. a brand-new spreadsheet) gets the template.
    const g = await api.read(OVERVIEW)
    if (findRow(g, (a) => /^monthly earnings$/i.test(a)) < 0 && g.filter((r) => r.some((c) => text(c))).length === 0) {
      await api.write(overviewTemplate().map((r, i) => ({ range: `${q(OVERVIEW)}!A${i + 1}`, values: [r.length ? r : ['']] })), 'USER_ENTERED')
    }
    return t
  }
  const res = await api.batch([{ addSheet: { properties: { title: OVERVIEW, index: 0 } } }])
  const info = res.replies?.[0]?.addSheet?.properties ?? { title: OVERVIEW, sheetId: -1, index: 0 }
  await api.write(overviewTemplate().map((r, i) => ({ range: `${q(OVERVIEW)}!A${i + 1}`, values: [r.length ? r : ['']] })), 'USER_ENTERED')
  return info
}

async function writeSection(
  api: SheetsApi,
  tab: TabInfo,
  match: (a: string) => boolean,
  rows: { raw: Cell[]; formulas?: (row: number) => (string | null)[] }[],
  totalCols: number[],
) {
  const grid = await api.read(tab.title)
  const title = findRow(grid, match)
  if (title < 0) return false
  const header = title + 1
  const tot = findRow(grid, (a) => /^total$/i.test(a), header + 1)
  if (tot < 0) return false
  const { first, last, totalRow } = await resizeBlock(api, tab, header, tot, rows.length)
  const width = Math.max(1, ...rows.map((r) => r.raw.length))
  const raws = rows.length ? rows.map((r) => [...r.raw, ...Array(width - r.raw.length).fill('')]) : [Array(width).fill('')]
  await api.write([{ range: `${q(tab.title)}!A${first}:${colLetter(width - 1)}${last}`, values: raws }], 'RAW')
  const f: { range: string; values: Grid }[] = []
  rows.forEach((r, i) => {
    const row = first + i
    r.formulas?.(row).forEach((v, j) => {
      if (v) f.push({ range: `${q(tab.title)}!${colLetter(j)}${row}`, values: [[v]] })
    })
  })
  for (const c of totalCols) f.push({ range: `${q(tab.title)}!${colLetter(c)}${totalRow}`, values: [[`=SUM(${colLetter(c)}${first}:${colLetter(c)}${last})`]] })
  if (f.length) await api.write(f, 'USER_ENTERED')
  return true
}

async function writeOverview(api: SheetsApi, tab: TabInfo, model: SheetModel, monthTabs: { key: string; tab: string; short: string }[]) {
  // Bottom-up so earlier sections keep their row positions while we resize.
  await writeSection(api, tab, (a) => /^project earnings/i.test(a), model.projects.map((p) => ({ raw: [p.name, p.earned] })), [1])
  await writeSection(
    api,
    tab,
    (a) => /21st-to-21st|work cycles/i.test(a),
    model.cycles.map((c) => ({ raw: [c.label, ...c.values] })),
    [1, 2, 3, 4, 5, 6],
  )
  await writeSection(
    api,
    tab,
    (a) => /^monthly earnings$/i.test(a),
    monthTabs.map((m) => ({
      raw: [m.short],
      formulas: () => [null, `=${q(m.tab)}!H3`, `=${q(m.tab)}!B4`, `=${q(m.tab)}!D4`, `=${q(m.tab)}!B3`, `=${q(m.tab)}!D3`, `=${q(m.tab)}!F3`],
    })),
    [1, 2, 3, 4, 5, 6],
  )
}

// ---------------------------------------------------------------- data tab

const DATA_TAB = 'Earnings data'

async function writeDataTab(api: SheetsApi, tabs: TabInfo[], model: SheetModel, syncedAt: Date) {
  if (!tabs.find((t) => t.title === DATA_TAB)) await api.batch([{ addSheet: { properties: { title: DATA_TAB, index: tabs.length } } }])
  await api.clear(`${q(DATA_TAB)}!A1:Z5000`)
  await api.write(
    [{ range: `${q(DATA_TAB)}!A1`, values: [[`Synced from ChaChing ${syncedAt.toISOString()} — this tab is rewritten on every sync`], ...model.data] }],
    'RAW',
  )
}

// ---------------------------------------------------------------- entry point

export interface SheetSyncResult {
  monthsWritten: string[]
  createdTabs: string[]
}

export async function syncSpreadsheet(api: SheetsApi, model: SheetModel, now = new Date()): Promise<SheetSyncResult> {
  let tabs = await api.tabs()
  const created: string[] = []
  const overview = await ensureOverview(api, tabs)
  if (!tabs.find((t) => t.title === OVERVIEW)) created.push(OVERVIEW)
  tabs = await api.tabs()
  for (const m of model.months) {
    const had = tabs.some((t) => t.title === m.tab)
    const tab = await ensureMonthTab(api, tabs, m)
    if (!had) created.push(m.tab)
    tabs = await api.tabs()
    await writeMonthTab(api, tabs.find((t) => t.title === m.tab) ?? tab, m)
  }
  // Month tabs that exist in the sheet but have no payments now: clear their rows.
  for (const t of tabs) {
    const key = monthKeyForTab(t.title)
    if (key && !model.months.some((m) => m.key === key)) {
      await writeMonthTab(api, t, { key, tab: t.title, short: shortForMonth(key), rows: [] })
    }
  }
  const allMonths = tabs
    .map((t) => ({ key: monthKeyForTab(t.title), tab: t.title }))
    .filter((x): x is { key: string; tab: string } => !!x.key)
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((x) => ({ ...x, short: shortForMonth(x.key) }))
  await writeOverview(api, tabs.find((t) => t.title === OVERVIEW) ?? overview, model, allMonths)
  await writeDataTab(api, await api.tabs(), model, now)
  return { monthsWritten: model.months.map((m) => m.tab), createdTabs: created }
}

/** Accept a full Google Sheets URL or a bare spreadsheet id. */
export function spreadsheetIdFrom(input: string): string | null {
  const t = input.trim()
  const m = t.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/) ?? t.match(/^([a-zA-Z0-9-_]{20,})$/)
  return m ? m[1] : null
}
