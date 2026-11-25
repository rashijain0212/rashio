// In-memory stand-in for the Google Sheets API used by tests. Mirrors the parts
// of Sheets behaviour the sync relies on: row insert/delete with reference
// shifting, sheet duplication, and evaluation of SUM/SUMIF/arithmetic formulas.
import type { Grid, SheetsApi, TabInfo } from '../lib/sheets'

interface Tab extends TabInfo {
  grid: Grid
}

const A1 = /('(?:[^']|'')+'|[A-Za-z0-9_]+)?(!)?\$?([A-Z]{1,2})\$?(\d+)(?::\$?([A-Z]{1,2})\$?(\d+))?/g

export class FakeSheets implements SheetsApi {
  sheets: Tab[] = []
  private nextId = 100
  writes = 0

  addTab(title: string, grid: Grid, index = this.sheets.length) {
    this.sheets.splice(index, 0, { title, sheetId: this.nextId++, index, grid: grid.map((r) => [...r]) })
    this.reindex()
  }
  private reindex() {
    this.sheets.forEach((t, i) => (t.index = i))
  }
  tab(title: string): Tab {
    const t = this.sheets.find((s) => s.title === title)
    if (!t) throw new Error(`no tab ${title}`)
    return t
  }
  async tabs() {
    return this.sheets.map(({ title, sheetId, index }) => ({ title, sheetId, index }))
  }
  async read(title: string) {
    return this.tab(title).grid.map((r) => [...r])
  }

  /** Shift row references in every formula after inserting/deleting rows in `title`. */
  private shift(title: string, at: number, delta: number, delEnd?: number) {
    for (const t of this.sheets) {
      for (const row of t.grid) {
        row.forEach((c, j) => {
          if (typeof c !== 'string' || !c.startsWith('=')) return
          row[j] = c.replace(A1, (m, sheet, bang, c1, r1, c2, r2) => {
            const target = sheet ? sheet.replace(/^'|'$/g, '').replace(/''/g, "'") : t.title
            if (!bang && sheet) return m // function name like SUM( — not a ref
            if (target !== title) return m
            const adj = (r: number, isEnd: boolean) => {
              if (delta > 0) return r >= at ? r + delta : r
              // deletion of rows [at, delEnd)
              if (r >= delEnd!) return r + delta
              if (r >= at) return isEnd ? at - 1 : at
              return r
            }
            const n1 = adj(Number(r1), false)
            const prefix = sheet ? `${sheet}!` : ''
            if (!c2) return `${prefix}${c1}${n1}`
            return `${prefix}${c1}${n1}:${c2}${adj(Number(r2), true)}`
          })
        })
      }
    }
  }

  async batch(requests: object[]) {
    const replies: { duplicateSheet?: { properties: TabInfo }; addSheet?: { properties: TabInfo } }[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of requests as Record<string, any>[]) {
      if (r.insertDimension) {
        const { sheetId, startIndex, endIndex } = r.insertDimension.range
        const t = this.sheets.find((s) => s.sheetId === sheetId)!
        const n = endIndex - startIndex
        const tmpl = r.insertDimension.inheritFromBefore ? t.grid[startIndex - 1] : undefined
        t.grid.splice(startIndex, 0, ...Array.from({ length: n }, () => (tmpl ? tmpl.map(() => '') : [])))
        this.shift(t.title, startIndex + 1, n)
        replies.push({})
      } else if (r.deleteDimension) {
        const { sheetId, startIndex, endIndex } = r.deleteDimension.range
        const t = this.sheets.find((s) => s.sheetId === sheetId)!
        t.grid.splice(startIndex, endIndex - startIndex)
        this.shift(t.title, startIndex + 1, -(endIndex - startIndex), endIndex + 1)
        replies.push({})
      } else if (r.duplicateSheet) {
        const src = this.sheets.find((s) => s.sheetId === r.duplicateSheet.sourceSheetId)!
        const grid = src.grid.map((row) => [...row])
        this.addTab(r.duplicateSheet.newSheetName, grid, r.duplicateSheet.insertSheetIndex)
        const t = this.tab(r.duplicateSheet.newSheetName)
        replies.push({ duplicateSheet: { properties: { title: t.title, sheetId: t.sheetId, index: t.index } } })
      } else if (r.addSheet) {
        const p = r.addSheet.properties
        this.addTab(p.title, [], Math.min(p.index ?? this.sheets.length, this.sheets.length))
        const t = this.tab(p.title)
        replies.push({ addSheet: { properties: { title: t.title, sheetId: t.sheetId, index: t.index } } })
      } else replies.push({})
    }
    return { replies }
  }

  async write(data: { range: string; values: Grid }[], mode: 'RAW' | 'USER_ENTERED') {
    for (const d of data) {
      this.writes++
      const m = d.range.match(/^'((?:[^']|'')+)'!([A-Z]+)(\d+)/)!
      const t = this.tab(m[1].replace(/''/g, "'"))
      const col0 = m[2].charCodeAt(0) - 65
      const row0 = Number(m[3]) - 1
      d.values.forEach((vals, i) => {
        const row = (t.grid[row0 + i] ??= [])
        vals.forEach((v, j) => {
          while (row.length < col0 + j) row.push('')
          row[col0 + j] = mode === 'RAW' && typeof v === 'string' && v.startsWith('=') ? `'${v}` : v
        })
      })
      for (let i = 0; i < t.grid.length; i++) t.grid[i] ??= []
    }
  }

  async clear(range: string) {
    const m = range.match(/^'((?:[^']|'')+)'!/)!
    this.tab(m[1].replace(/''/g, "'")).grid = []
  }

  // ------------------------------------------------------------ evaluation
  value(title: string, ref: string): number | string {
    const m = ref.match(/^([A-Z]+)(\d+)$/)!
    const c = this.tab(title).grid[Number(m[2]) - 1]?.[m[1].charCodeAt(0) - 65]
    if (typeof c === 'string' && c.startsWith('=')) return this.evalFormula(title, c.slice(1))
    return c === undefined || c === '' ? 0 : c
  }
  private range(title: string, a: string, b: string): (number | string)[] {
    const [, c1, r1] = a.match(/^([A-Z]+)(\d+)$/)!
    const [, c2, r2] = b.match(/^([A-Z]+)(\d+)$/)!
    const out: (number | string)[] = []
    for (let r = Number(r1); r <= Number(r2); r++)
      for (let c = c1.charCodeAt(0); c <= c2.charCodeAt(0); c++) out.push(this.value(title, `${String.fromCharCode(c)}${r}`))
    return out
  }
  private evalFormula(title: string, f: string): number {
    const sheetRef = /^'((?:[^']|'')+)'!([A-Z]+\d+)$/.exec(f)
    if (sheetRef) return Number(this.value(sheetRef[1].replace(/''/g, "'"), sheetRef[2]))
    let m = /^SUM\(([A-Z]+\d+):([A-Z]+\d+)\)$/.exec(f)
    if (m) return this.range(title, m[1], m[2]).reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0)
    m = /^SUMIF\(([A-Z]+\d+):([A-Z]+\d+),"([^"]*)",([A-Z]+\d+):([A-Z]+\d+)\)$/.exec(f)
    if (m) {
      const crit = this.range(title, m[1], m[2])
      const vals = this.range(title, m[4], m[5])
      const ok = (v: number | string) => (m![3].startsWith('>') ? typeof v === 'number' && v > Number(m![3].slice(1)) : v === m![3])
      return crit.reduce<number>((s, c, i) => s + (ok(c) && typeof vals[i] === 'number' ? (vals[i] as number) : 0), 0)
    }
    m = /^([A-Z]+\d+)-([A-Z]+\d+)$/.exec(f)
    if (m) return Number(this.value(title, m[1])) - Number(this.value(title, m[2]))
    m = /^([A-Z]+\d+)$/.exec(f)
    if (m) return Number(this.value(title, m[1]))
    throw new Error(`cannot evaluate ${f}`)
  }
}

/** Layout of the user's existing workbook (synthetic values). */
export function existingWorkbook(): FakeSheets {
  const fs = new FakeSheets()
  fs.addTab('Overview', [
    ['Earnings overview'],
    ['Grouped by work period, not payout date · USD'],
    ['Total earned', '=E10', 'Paid', '=F10', 'Pending', '=G10'],
    ['Hours', '=B10', 'Hourly pay', '=C10', 'Incentives / trial', '=D10'],
    [],
    ['MONTHLY EARNINGS'],
    ['Period', 'Hours', 'Hourly pay', 'Incentives / trial', 'Total earned', 'Paid', 'Pending'],
    ['Oct 2026', "='October 2026'!H3", "='October 2026'!B4", "='October 2026'!D4", "='October 2026'!B3", "='October 2026'!D3", "='October 2026'!F3"],
    ['Nov 2026', "='November 2026'!H3", "='November 2026'!B4", "='November 2026'!D4", "='November 2026'!B3", "='November 2026'!D3", "='November 2026'!F3"],
    ['TOTAL', '=SUM(B8:B9)', '=SUM(C8:C9)', '=SUM(D8:D9)', '=SUM(E8:E9)', '=SUM(F8:F9)', '=SUM(G8:G9)'],
    [],
    ['21ST-TO-21ST WORK CYCLES'],
    ['Period', 'Hours', 'Hourly pay', 'Incentives / trial', 'Total earned', 'Paid', 'Pending'],
    ['Oct 21 – Nov 21', 1, 1, 0, 1, 1, 0],
    ['TOTAL', '=SUM(B14:B14)', 0, 0, 0, 0, 0],
    [],
    ['PROJECT EARNINGS | dashboard snapshot'],
    ['Project', 'Earned'],
    ['Old project', 5],
    ['Older project', 6],
    ['TOTAL', '=SUM(B19:B20)'],
    ['Note: kept as written by the owner'],
  ])
  const month = (short: string, rows: Grid) => {
    const L = 6 + rows.length
    return [
      [`${short} | Work earnings`],
      ['Work period determines month; payout dates are retained for tracking.'],
      ['Earned', `=SUM(E7:E${L})`, 'Paid', `=SUMIF(F7:F${L},"Paid",E7:E${L})`, 'Pending', `=SUMIF(F7:F${L},"Upcoming",E7:E${L})`, 'Hours', `=SUM(C7:C${L})`],
      ['Hourly earnings', `=SUMIF(D7:D${L},">0",E7:E${L})`, 'Incentives / trial', '=B3-B4'],
      [],
      ['Work period', 'Contract', 'Hours', 'Rate / hr', 'Earned (USD)', 'Status', 'Payout date', 'Sent / release', 'Work date*'],
      ...rows,
      ['TOTAL', '', `=SUM(C7:C${L})`, '', `=SUM(E7:E${L})`],
      [],
      ['Payment status', 'Paid', 'Pending'],
      [short, '=D3', '=F3'],
      [],
      ['Earnings type', 'Hourly', 'Incentives / trial'],
      [short, '=B4', '=D4'],
    ]
  }
  fs.addTab('October 2026', month('Oct 2026', [['Old', 'X', 1, 85, 85, 'Paid', 1, 1, 1], ['Old2', 'X', 1, 85, 85, 'Paid', 1, 1, 1], ['Old3', 'X', '', '', 10, 'Paid', 1, 1, 1]]))
  fs.addTab('November 2026', month('Nov 2026', [['Old', 'X', 1, 85, 85, 'Upcoming', 1, 1, 1]]))
  return fs
}
