// Deterministic parser for raw text copied from the earnings page.
// It is intentionally format-tolerant: copied tables may arrive as one row per
// line with tab-separated cells, or as one cell per line. No AI / network calls.

import { findMoney, parseMoneyToCents } from './money'
import { parseCopiedDashboard } from './dashboard'
import { isValidYMD, monthIndex, toISO, toDayNumber, addDays } from './dates'
import type {
  ParseResult,
  ParsedPayment,
  ParsedProject,
  ParsedSummary,
  PaymentStatus,
  PaymentType,
} from './types'

export interface ParseOptions {
  /** Reference "today" used to infer missing years. */
  now?: Date
}

// ---------------------------------------------------------------- normalize

export function normalizeText(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .split('\n')
    .map((l) => l.replace(/[ ]{2,}/g, ' ').replace(/\s+$/g, '').replace(/^\s+/g, ''))
    .filter((l) => l.length > 0)
}

// ---------------------------------------------------------------- dates

interface PartialDate {
  y: number | null
  m: number
  d: number
}

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DATE_TEXT = `${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`
const DATE_NUM = '(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?'
const DATE_ISO = '(\\d{4})-(\\d{2})-(\\d{2})'
const ANY_DATE = `(?:${DATE_ISO}|${DATE_TEXT}|${DATE_NUM})`

function partialFromMatch(m: RegExpMatchArray, offset = 1): PartialDate | null {
  const g = (i: number) => m[offset + i]
  if (g(0)) return { y: +g(0), m: +g(1), d: +g(2) }
  if (g(3)) {
    const mi = monthIndex(g(3))
    if (!mi) return null
    return { y: g(5) ? +g(5) : null, m: mi, d: +g(4) }
  }
  if (g(6)) {
    let y: number | null = g(8) ? +g(8) : null
    if (y !== null && y < 100) y += 2000
    return { y, m: +g(6), d: +g(7) }
  }
  return null
}

const SINGLE_DATE_RE = new RegExp(`^${ANY_DATE}$`, 'i')
const DATE_ANYWHERE_RE = new RegExp(ANY_DATE, 'i')

/** "Nov 21 - Nov 27, 2025", "Nov 21-27", "11/21/2025 - 11/27/2025", "2025-11-21 to 2025-11-27" */
const RANGE_RE = new RegExp(
  `${ANY_DATE}\\s*(?:-|to|through|thru|\u2013)\\s*(?:${ANY_DATE}|(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?)`,
  'i',
)

function resolveYear(p: PartialDate, refYear: number): string | null {
  const y = p.y ?? refYear
  if (!isValidYMD(y, p.m, p.d)) return null
  return toISO(y, p.m, p.d)
}

export function parseSingleDate(s: string, ref: Date): string | null {
  const m = s.trim().match(SINGLE_DATE_RE)
  if (!m) return null
  const p = partialFromMatch(m)
  if (!p) return null
  return inferYear(p, ref)
}

/** Infer missing year: assume within ~10 months back / 2 months ahead of `ref`. */
function inferYear(p: PartialDate, ref: Date): string | null {
  if (p.y !== null) return resolveYear(p, p.y)
  const refISO = toISO(ref.getFullYear(), ref.getMonth() + 1, ref.getDate())
  let iso = resolveYear(p, ref.getFullYear())
  if (!iso) return null
  if (toDayNumber(iso) > toDayNumber(addDays(refISO, 60))) iso = resolveYear(p, ref.getFullYear() - 1)
  return iso
}

export function parseRange(
  s: string,
  ref: Date,
  anchor: string | null,
): { start: string; end: string } | null {
  const m = s.match(RANGE_RE)
  if (!m) return null
  const ANY_GROUPS = 9
  const a = partialFromMatch(m, 1)
  let b = partialFromMatch(m, 1 + ANY_GROUPS)
  if (!b && m[1 + ANY_GROUPS * 2]) {
    // "Nov 21-27" shorthand: same month as start
    if (!a) return null
    b = { y: m[2 + ANY_GROUPS * 2] ? +m[2 + ANY_GROUPS * 2] : a.y, m: a.m, d: +m[1 + ANY_GROUPS * 2] }
  }
  if (!a || !b) return null
  // Propagate known years
  let ay = a.y
  let by = b.y
  if (by === null && ay !== null) by = b.m < a.m ? ay + 1 : ay
  if (ay === null && by !== null) ay = b.m < a.m ? by - 1 : by
  if (ay === null || by === null) {
    // No year anywhere: anchor to the payout date (work precedes payout) or ref.
    const anchorISO = anchor ?? toISO(ref.getFullYear(), ref.getMonth() + 1, ref.getDate())
    const anchorY = +anchorISO.slice(0, 4)
    by = anchorY
    let endISO = resolveYear({ y: by, m: b.m, d: b.d }, by)
    if (endISO && toDayNumber(endISO) > toDayNumber(addDays(anchorISO, anchor ? 7 : 60))) {
      by -= 1
      endISO = resolveYear({ y: by, m: b.m, d: b.d }, by)
    }
    ay = b.m < a.m ? by - 1 : by
  }
  const start = resolveYear({ ...a, y: ay }, ay)
  const end = resolveYear({ ...b, y: by }, by)
  if (!start || !end || end < start) return null
  return { start, end }
}

// ---------------------------------------------------------------- vocab

const STATUS_WORDS: [RegExp, PaymentStatus][] = [
  [/^(paid|completed?|released|deposited|sent|success(ful)?)$/i, 'paid'],
  [/^(pending|scheduled|upcoming|approved|awaiting( payout)?|not yet paid|unpaid|in review|under review)$/i, 'pending'],
  [/^(processing|in progress|in transit|initiated)$/i, 'processing'],
  [/^(failed|rejected|declined|cancell?ed|returned|reversed)$/i, 'failed'],
]

export function matchStatus(s: string): PaymentStatus | null {
  const t = s.trim().replace(/[.:]$/, '')
  for (const [re, st] of STATUS_WORDS) if (re.test(t)) return st
  return null
}

const TYPE_WORDS: [RegExp, PaymentType][] = [
  [/^(hourly|hourly (work|pay|payment|rate)|hours|time ?sheet|timesheet|regular( hours)?)$/i, 'hourly'],
  [/^(work ?trial|trial|paid trial|trial task|assessment|paid assessment)$/i, 'work_trial'],
  [/^(incentive|incentives|bonus|bonuses|performance bonus|referral( bonus)?|reward|stipend|completion bonus|quality bonus|milestone( bonus)?|sign[- ]?on bonus|task bonus|per[- ]task|fixed( price)?|one[- ]time( payment)?)$/i, 'incentive'],
  [/^(adjustment|other|correction|reimbursement|misc(ellaneous)?)$/i, 'other'],
]

export function matchType(s: string): PaymentType | null {
  const t = s.trim().replace(/[.:]$/, '')
  for (const [re, ty] of TYPE_WORDS) if (re.test(t)) return ty
  return null
}

const PROJECT_STATUS_RE = /^(active|inactive|ended|completed|paused|closed|offboarded|archived)$/i

// Navigation, headings, column headers and chart labels to ignore.
const IGNORE_RE = new RegExp(
  [
    '^(home|dashboard|jobs?|explore|work|earnings|payments?|payouts?|settings|profile|account|referrals?|messages?|inbox|notifications?|help|support|log ?out|sign ?out|log ?in|menu|search|back|next|previous|prev|more|view all|see all|show more|show less|load more|filter|filters|sort|sort by|export|download|all|today|this (week|month|year)|last (week|month|year)|all time|ytd)$',
    '^(payout date|date|contract|contract name|project|project name|type|payment type|work period|period|hours|hours worked|earnings|amount|actual earnings|rate|hourly rate|status|payment status|release date|expected release|released|expected|details|actions?|description)$',
    '^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)( \\d{2}|\\d{4})?$',
    '^\\$?\\d+(\\.\\d+)?k$',
    '^page \\d+( of \\d+)?$',
    '^showing .*results?$',
    '^\\d+\\s*-\\s*\\d+ of \\d+$',
    '^\u00a9',
    '^(privacy|terms)( policy| of service)?$',
      ].join('|'),
  'i',
)

const TABLE_HEADER_HINTS = /(payout date|work period|payment type|contract|hours|earnings|status)/i

function isHeaderLine(line: string): boolean {
  const cells = splitCells(line)
  if (cells.length >= 3) {
    const hits = cells.filter((c) => IGNORE_RE.test(c) || TABLE_HEADER_HINTS.test(c)).length
    return hits >= Math.max(3, Math.ceil(cells.length * 0.6)) && findMoney(line).length === 0
  }
  return false
}

function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim()).filter(Boolean)
  if (line.includes(' | ')) return line.split('|').map((c) => c.trim()).filter(Boolean)
  return [line]
}

const HOURS_RE = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)$/i
const HM_RE = /^(\d+)\s*h(?:r|rs)?\s*(\d+)\s*m(?:in|ins)?$/i
const HHMM_RE = /^(\d{1,3}):([0-5]\d)$/
const MIN_RE = /^(\d+)\s*m(?:in|ins|inutes)?$/i

export function parseHours(s: string): number | null {
  const t = s.trim()
  let m = t.match(HOURS_RE)
  if (m) return +m[1]
  m = t.match(HM_RE)
  if (m) return Math.round((+m[1] + +m[2] / 60) * 100) / 100
  m = t.match(HHMM_RE)
  if (m) return Math.round((+m[1] + +m[2] / 60) * 100) / 100
  m = t.match(MIN_RE)
  if (m) return Math.round((+m[1] / 60) * 100) / 100
  return null
}

// ---------------------------------------------------------------- summary

const SUMMARY_LABELS: { key: keyof ParsedSummary | 'nextPayout'; re: RegExp }[] = [
  { key: 'lifetimeCents', re: /^(total|lifetime|all[- ]time)( lifetime)? (earnings|earned)|^total earned|^lifetime$/i },
  { key: 'nextPayout', re: /^(next|upcoming) payout/i },
  { key: 'currentPayoutCents', re: /^(current payout|current balance|available( balance)?|pending payout|balance)/i },
  { key: 'paidThisMonthCents', re: /^paid (this|in this) month/i },
  { key: 'payoutCount', re: /^((number of|total|#) )?payouts?( count| made| received)?$/i },
]

interface Consumed {
  set: Set<number>
}

function extractSummary(lines: string[], ref: Date, consumed: Consumed): ParsedSummary {
  const s: ParsedSummary = {
    lifetimeCents: null,
    currentPayoutCents: null,
    nextPayoutCents: null,
    nextPayoutDate: null,
    paidThisMonthCents: null,
    payoutCount: null,
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const { key, re } of SUMMARY_LABELS) {
      const cells = splitCells(line)
      const labelPart = (cells.length > 1 ? cells[0] : line.replace(/[:\-\u2013]\s*.*$/, '')).replace(/:$/, '').trim()
      const restOfLine = cells.length > 1 ? cells.slice(1).join(' ') : line.replace(re, '').replace(/^[:\s]+/, '')
      if (!re.test(labelPart) && !re.test(line)) continue
      // Look at this line and the next 3 lines for the value(s).
      const window: number[] = [i, i + 1, i + 2, i + 3].filter((j) => j < lines.length)
      if (key === 'payoutCount') {
        for (const j of window.slice(0, 3)) {
          const t = j === i ? restOfLine : lines[j]
          const n = t.match(/^(\d{1,4})(?:\s*payouts?)?$/i)
          if (n) {
            if (s.payoutCount === null) s.payoutCount = +n[1]
            consumed.set.add(i)
            consumed.set.add(j)
            break
          }
        }
        continue
      }
      let money: number | null = null
      let date: string | null = null
      for (const j of window) {
        if (j !== i && SUMMARY_LABELS.some((l) => l.re.test(lines[j]))) break
        const mon = findMoney(lines[j])
        if (money === null && mon.length) {
          money = mon[0].cents
          consumed.set.add(j)
        }
        if (key === 'nextPayout' && !date) {
          const dm = lines[j].match(DATE_ANYWHERE_RE)
          if (dm && !RANGE_RE.test(lines[j])) {
            const p = partialFromMatch(dm)
            if (p) {
              date = inferYear(p, ref)
              consumed.set.add(j)
            }
          }
        }
        if (money !== null && (key !== 'nextPayout' || date)) break
      }
      consumed.set.add(i)
      if (key === 'nextPayout') {
        if (s.nextPayoutCents === null) s.nextPayoutCents = money
        if (s.nextPayoutDate === null) s.nextPayoutDate = date
      } else if (money !== null && s[key] === null) {
        ;(s[key] as number | null) = money
      }
      break
    }
  }
  return s
}

// ---------------------------------------------------------------- projects

function findSectionStart(lines: string[], re: RegExp, from = 0): number {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i
  return -1
}

const PROJECTS_HEADING = /^(my |your |active )?(projects|contracts|engagements)( overview| summary)?$/i
const PAYMENTS_HEADING = /^(payout|payment|earnings|transaction)s?( history| details| breakdown| log)?$|^(recent|all|past) (payouts|payments|transactions)$|^history$/i

function extractProjects(lines: string[], start: number, end: number, consumed: Consumed): ParsedProject[] {
  const projects: ParsedProject[] = []
  let cur: ParsedProject | null = null
  for (let i = start + 1; i < end; i++) {
    const line = lines[i]
    if (isHeaderLine(line)) {
      consumed.set.add(i)
      continue
    }
    const cells = splitCells(line)
    if (cells.length > 1) {
      // "Project A \t $1,234.00 \t Active"
      const name = cells.find((c) => !findMoney(c).length && !PROJECT_STATUS_RE.test(c) && !IGNORE_RE.test(c))
      if (!name) continue
      const money = findMoney(line)
      const st = cells.find((c) => PROJECT_STATUS_RE.test(c))
      projects.push({
        name,
        earningsCents: money.length ? money[0].cents : null,
        active: st ? /^active$/i.test(st) : null,
      })
      consumed.set.add(i)
      cur = null
      continue
    }
    if (IGNORE_RE.test(line)) continue
    const money = findMoney(line)
    if (money.length && cur) {
      if (cur.earningsCents === null) cur.earningsCents = money[0].cents
      const rest = line.replace(money[0].raw, '').trim()
      if (PROJECT_STATUS_RE.test(rest)) cur.active = /^active$/i.test(rest)
      consumed.set.add(i)
      continue
    }
    if (PROJECT_STATUS_RE.test(line) && cur) {
      cur.active = /^active$/i.test(line)
      consumed.set.add(i)
      continue
    }
    if (!money.length && !/\d{4}|\$/.test(line) && line.length <= 120) {
      // Inline "Project A Active"
      const inline = line.match(/^(.*?)\s+(active|inactive|ended|paused|completed)$/i)
      cur = {
        name: inline ? inline[1] : line,
        earningsCents: null,
        active: inline ? /^active$/i.test(inline[2]) : null,
      }
      projects.push(cur)
      consumed.set.add(i)
    }
  }
  return projects.filter((p) => p.earningsCents !== null || p.active !== null)
}

// ---------------------------------------------------------------- payments

interface Draft {
  contract: string | null
  extraText: string[]
  type: PaymentType | null
  typeLabel: string | null
  workStart: string | null
  workEnd: string | null
  payoutDate: string | null
  hours: number | null
  monies: { cents: number; perHour: boolean }[]
  status: PaymentStatus | null
  statusLabel: string | null
  releaseDate: string | null
  releaseKind: 'actual' | 'expected' | null
  raw: string[]
}

function newDraft(): Draft {
  return {
    contract: null,
    extraText: [],
    type: null,
    typeLabel: null,
    workStart: null,
    workEnd: null,
    payoutDate: null,
    hours: null,
    monies: [],
    status: null,
    statusLabel: null,
    releaseDate: null,
    releaseKind: null,
    raw: [],
  }
}

const RELEASE_PREFIX = /^(released|paid|paid on|released on|sent on|deposited( on)?|arrived( on)?)\s*:?\s*/i
const EXPECTED_PREFIX = /^(expected|expected on|est\.?|estimated|eta|releases?|releases? on|scheduled( for)?|available( on)?|arrives?( on| by)?|by)\s*:?\s*/i
const PAYOUT_PREFIX = /^(payout( date)?|paid out|date)\s*:?\s*/i
const WORK_PREFIX = /^(work period|period|week of|for work)\s*:?\s*/i
const HOURS_PREFIX = /^(hours( worked)?|time)\s*:?\s*/i

function hasMoney(d: Draft): boolean {
  return d.monies.some((m) => !m.perHour)
}

function isComplete(d: Draft): boolean {
  return hasMoney(d) && (d.contract !== null || d.workStart !== null || d.payoutDate !== null)
}

/** Feed one cell into a draft. Returns false if the cell should start a new record. */
function feedCell(d: Draft, cellRaw: string, ref: Date, rowMode: boolean): boolean | 'ignored' {
  const cell = cellRaw.trim()
  if (!cell) return 'ignored'

  // Work period (range)
  const rangeSource = cell.replace(WORK_PREFIX, '')
  if (RANGE_RE.test(rangeSource) && !findMoney(cell).length) {
    const fullMatch = rangeSource.match(RANGE_RE)
    if (fullMatch && fullMatch[0].length >= rangeSource.length - 6) {
      if (d.workStart && !rowMode && isComplete(d)) return false
      if (d.workStart) return 'ignored'
      const r = parseRange(rangeSource, ref, d.payoutDate)
      if (r) {
        d.workStart = r.start
        d.workEnd = r.end
        d.raw.push(cell)
        return true
      }
    }
  }

  // Release / expected / payout dates with prefixes
  for (const [re, kind] of [
    [RELEASE_PREFIX, 'actual'],
    [EXPECTED_PREFIX, 'expected'],
  ] as const) {
    if (re.test(cell)) {
      const rest = cell.replace(re, '')
      const iso = parseSingleDate(rest, ref)
      if (iso) {
        if (d.releaseDate && !rowMode && isComplete(d)) return false
        d.releaseDate = iso
        d.releaseKind = kind
        d.raw.push(cell)
        return true
      }
    }
  }
  if (PAYOUT_PREFIX.test(cell)) {
    const iso = parseSingleDate(cell.replace(PAYOUT_PREFIX, ''), ref)
    if (iso) {
      if (d.payoutDate && !rowMode) return false
      d.payoutDate = iso
      d.raw.push(cell)
      return true
    }
  }

  // Bare single date
  const iso = parseSingleDate(cell, ref)
  if (iso) {
    // A bare date after a finished record starts the next record.
    if (!rowMode && isComplete(d) && d.status !== null) return false
    if (!d.payoutDate) {
      d.payoutDate = iso
    } else if (!d.workStart && d.status === null && !hasMoney(d)) {
      // Single-day work date (incentives / work trials: "Nov 12")
      d.workStart = iso
      d.workEnd = iso
    } else if (!d.releaseDate) {
      d.releaseDate = iso
      d.releaseKind = d.status === 'paid' ? 'actual' : 'expected'
    } else {
      return rowMode ? 'ignored' : false
    }
    d.raw.push(cell)
    return true
  }

  // Hours
  const hours = parseHours(cell.replace(HOURS_PREFIX, ''))
  if (hours !== null) {
    if (d.hours !== null && !rowMode && isComplete(d)) return false
    d.hours = hours
    d.raw.push(cell)
    return true
  }

  // Status (may be combined with a date: "Paid Dec 2" / "Pending - expected Dec 9")
  const statusHead = cell.match(/^([A-Za-z ]+?)(?:\s*[-\u00b7\u2022,(:]\s*|\s+)(.*)$/)
  const st = matchStatus(cell) ?? (statusHead ? matchStatus(statusHead[1]) : null)
  if (st) {
    if (d.status && !rowMode && isComplete(d)) return false
    d.status = st
    d.statusLabel = matchStatus(cell) ? cell : statusHead![1]
    if (!matchStatus(cell) && statusHead) {
      const rest = statusHead[2].replace(/\)$/, '').replace(EXPECTED_PREFIX, '').replace(RELEASE_PREFIX, '')
      const rd = parseSingleDate(rest, ref)
      if (rd) {
        d.releaseDate = rd
        d.releaseKind = st === 'paid' ? 'actual' : 'expected'
      }
    }
    d.raw.push(cell)
    return true
  }

  // Payment type
  const ty = matchType(cell)
  if (ty) {
    if (d.type && !rowMode && isComplete(d)) return false
    d.type = ty
    d.typeLabel = cell
    d.raw.push(cell)
    return true
  }

  // Money
  const money = findMoney(cell)
  if (money.length) {
    const nonMoney = cell
      .replace(/[-\u2212]?\s?\$\s?[-\u2212]?[\d,]+(\.\d{1,2})?(\s*(\/\s*(hr|hour|h)\b|per\s+hour))?/gi, '')
      .replace(/\b(earned|earnings|amount|total|rate|usd)\b/gi, '')
      .replace(/[:\u2022\u00b7|()]/g, '')
      .trim()
    if (nonMoney.length > 0 && !/^@|^x$|^\u00d7$/.test(nonMoney)) {
      // "12.5 hrs \u00d7 $65/hr" or similar compound cells
      const h = nonMoney.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)\b/i)
      if (h && d.hours === null) d.hours = +h[1]
    }
    for (const m of money) {
      if (!m.perHour && hasMoney(d) && !rowMode && isComplete(d) && d.monies.length >= 2) return false
      d.monies.push({ cents: m.cents, perHour: m.perHour })
    }
    d.raw.push(cell)
    return true
  }

  // Plain number cell in a row: hours column without unit
  if (rowMode && /^\d+(\.\d+)?$/.test(cell) && d.hours === null) {
    d.hours = +cell
    d.raw.push(cell)
    return true
  }

  if (IGNORE_RE.test(cell) || isNoise(cell)) return 'ignored'

  // Remaining text is the contract name
  if (d.contract === null) {
    d.contract = cell
    d.raw.push(cell)
    return true
  }
  if (!rowMode && isComplete(d)) return false
  d.extraText.push(cell)
  d.raw.push(cell)
  return true
}

function isNoise(cell: string): boolean {
  if (cell.length > 160) return true
  if (/^[\d\s.,%/:-]+$/.test(cell)) return true
  if (/^(view|open|details|receipt|invoice|download|copy|more|\u2026|\.\.\.|\u22ef|\u203a|>|<)$/i.test(cell)) return true
  return false
}

function finalize(d: Draft, warnings: string[]): ParsedPayment | null {
  const earning = d.monies.filter((m) => !m.perHour)
  const perHour = d.monies.find((m) => m.perHour)
  if (!earning.length) return null
  if (!d.contract && !d.workStart && !d.payoutDate) return null

  let earningsCents = earning[0].cents
  let rateCents: number | null = perHour ? perHour.cents : null
  if (earning.length >= 2 && d.hours) {
    // Disambiguate [rate, earnings] vs [earnings, rate] using hours.
    const [a, b] = earning
    const close = (rate: number, total: number) => Math.abs(rate * d.hours! - total) <= Math.max(100, total * 0.03)
    if (close(a.cents, b.cents)) {
      rateCents = rateCents ?? a.cents
      earningsCents = b.cents
    } else if (close(b.cents, a.cents)) {
      rateCents = rateCents ?? b.cents
      earningsCents = a.cents
    } else {
      earningsCents = Math.max(a.cents, b.cents)
    }
  } else if (earning.length >= 2) {
    earningsCents = Math.max(...earning.map((e) => e.cents))
  }

  let type: PaymentType = d.type ?? (d.hours !== null && d.hours > 0 ? 'hourly' : 'other')
  if (!d.type && d.contract && /bonus|incentive|referral/i.test(d.contract)) type = 'incentive'
  if (!d.type && d.contract && /trial|assessment/i.test(d.contract)) type = 'work_trial'
  if (type !== 'hourly') rateCents = null

  // If the work period comes after the payout date, the year guess was off.
  if (d.workEnd && d.payoutDate && d.workEnd > addDays(d.payoutDate, 1)) {
    warnings.push(`Work period ${d.workStart}\u2013${d.workEnd} ends after payout ${d.payoutDate}; please review.`)
  }

  return {
    contract: (d.contract ?? 'Unknown contract').replace(/\s+/g, ' ').trim(),
    type,
    typeLabel: d.typeLabel ?? (type === 'hourly' ? 'Hourly' : type === 'incentive' ? 'Incentive' : type === 'work_trial' ? 'Work trial' : 'Other'),
    workStart: d.workStart,
    workEnd: d.workEnd,
    payoutDate: d.payoutDate,
    hours: d.hours,
    earningsCents,
    rateCents,
    status: d.status ?? 'other',
    statusLabel: d.statusLabel ?? '',
    releaseDate: d.releaseDate,
    releaseKind: d.releaseKind,
    raw: d.raw.join(' | '),
  }
}

function extractPayments(
  lines: string[],
  from: number,
  ref: Date,
  consumed: Consumed,
  warnings: string[],
  unparsed: string[],
): ParsedPayment[] {
  const out: ParsedPayment[] = []
  let d = newDraft()
  const flush = () => {
    if (d.raw.length) {
      const p = finalize(d, warnings)
      if (p) out.push(p)
      else if (d.raw.some((r) => /\$|\d/.test(r))) unparsed.push(d.raw.join(' | '))
    }
    d = newDraft()
  }

  for (let i = from; i < lines.length; i++) {
    if (consumed.set.has(i)) continue
    const line = lines[i]
    if (isHeaderLine(line)) continue
    const cells = splitCells(line)
    if (cells.length >= 3) {
      // Row mode: the whole line is one record.
      flush()
      for (const c of cells) feedCell(d, c, ref, true)
      flush()
      continue
    }
    const res = feedCell(d, line, ref, false)
    if (res === false) {
      flush()
      feedCell(d, line, ref, false)
    }
  }
  flush()
  return out
}

// ---------------------------------------------------------------- main

export function parseDashboardText(text: string, opts: ParseOptions = {}): ParseResult {
  const ref = opts.now ?? new Date()
  // Prefer the exact copied-dashboard format; fall back to the tolerant parser.
  const dash = parseCopiedDashboard(text, ref)
  if (dash && (dash.payments.length || dash.summary.lifetimeCents !== null)) return dash
  const warnings: string[] = []
  const unparsed: string[] = []
  const lines = normalizeText(text)
  if (!lines.length) {
    return {
      summary: emptySummary(),
      projects: [],
      payments: [],
      warnings: ['The pasted text is empty.'],
      unparsedLines: [],
    }
  }
  const consumed: Consumed = { set: new Set() }

  const projStart = findSectionStart(lines, PROJECTS_HEADING)
  let payStart = findSectionStart(lines, PAYMENTS_HEADING, projStart >= 0 ? projStart + 1 : 0)
  if (payStart < 0) {
    // Fall back to the first table header line
    payStart = lines.findIndex((l, i) => i > projStart && isHeaderLine(l))
  }

  // Summary values only come from text before the payments section.
  const summaryLines = payStart >= 0 ? lines.slice(0, payStart) : lines
  const summary = extractSummary(summaryLines, ref, consumed)

  let projects: ParsedProject[] = []
  if (projStart >= 0) {
    const projEnd = payStart > projStart ? payStart : lines.length
    projects = extractProjects(lines, projStart, projEnd, consumed)
    for (let i = projStart; i < projEnd; i++) consumed.set.add(i)
  }

  // Lines before the payments section that were not part of summary/projects
  // (charts, nav) are ignored when a payments section exists.
  const from = payStart >= 0 ? payStart + 1 : 0
  if (payStart >= 0) for (let i = 0; i < payStart; i++) consumed.set.add(i)

  const payments = extractPayments(lines, from, ref, consumed, warnings, unparsed)

  if (!payments.length) {
    warnings.push(
      summary.lifetimeCents !== null
        ? 'No individual payments were found \u2014 only summary figures. Did you copy the payout history table?'
        : 'No earnings data was recognised in the pasted text.',
    )
  }
  if (summary.payoutCount !== null && payments.length && summary.payoutCount !== countPayouts(payments)) {
    warnings.push(
      `Page says ${summary.payoutCount} payouts but ${countPayouts(payments)} distinct payout dates were parsed \u2014 this may be a partial page.`,
    )
  }
  return { summary, projects, payments, warnings, unparsedLines: unparsed }
}

function countPayouts(p: ParsedPayment[]): number {
  return new Set(p.map((x) => x.payoutDate ?? x.raw)).size
}

export function emptySummary(): ParsedSummary {
  return {
    lifetimeCents: null,
    currentPayoutCents: null,
    nextPayoutCents: null,
    nextPayoutDate: null,
    paidThisMonthCents: null,
    payoutCount: null,
  }
}

export { parseMoneyToCents }
