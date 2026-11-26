// Parser for the the dashboard "Earnings" dashboard as copied from the browser
// (Cmd/Ctrl+A, Cmd/Ctrl+C). In that copy, each payment row is one line with
// its cells run together, e.g.
//   Dec 2, 2026WriterContracts (Nov 21 - Nov 27)UpcomingReleases Dec 2, 20263.31$281.24
// and summary cards look like "Total earnings to date$13,626.91".
// Deterministic, no network or AI.

import { findMoney, parseMoneyToCents } from './money'
import { addDays } from './dates'
import { normalizeText, parseRange, parseSingleDate } from './parser'
import type { ParseResult, ParsedPayment, ParsedProject, ParsedSummary, PaymentStatus, PaymentType } from './types'

const MON = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?'
const FULL_DATE = `${MON}\\s+\\d{1,2},\\s*\\d{4}`
const TYPE_ALT =
  'Contracts?\\s*\\(([^)]*)\\)|Incentives?|Work\\s*[Tt]rials?(?:\\s*\\(([^)]*)\\))?|Bonus(?:es)?|Referrals?(?:\\s*[Bb]onus)?|Adjustments?|Reimbursements?|Other'
const STATUS_ALT = 'Upcoming|Released|Paid|Pending|Processing|In transit|Scheduled|Failed|Cancell?ed|Reversed|Returned'
const RELEASE_ALT =
  `Releases?\\s+(?:today|tomorrow|yesterday)\\s*(?:\\((?:PST|PDT|PT)\\))?|(?:Releases?|Released|Sent|Paid|Expected|Estimated|Arrives?|Arrived)(?:\\s+on)?\\s+${FULL_DATE}`

/** A full payment row (cells joined, optional whitespace/tabs between them). */
const ROW_RE = new RegExp(
  `^(${FULL_DATE})\\s*(.+?)\\s*(${TYPE_ALT})\\s*(${STATUS_ALT})\\s*(${RELEASE_ALT})?\\s*(-|\\u2014|\\d+(?:\\.\\d+)?)?\\s*(-?\\$\\s?[\\d,]+(?:\\.\\d{1,2})?)\\s*$`,
  'i',
)
const HEADER_CELLS = ['payout date', 'contract', 'type', 'status', 'hours', 'earned']

/** Number of lines the header occupies (6 when one cell per line, 1 when on one line). */
function HEADER_SPAN(lines: string[], at: number): number {
  return lines[at].toLowerCase().trim() === HEADER_CELLS[0] ? HEADER_CELLS.length : 1
}
const FOOTER_RE = /^(ask maven|©|privacy|terms)/i

/** Calendar date of `now` in America/Los_Angeles (the dashboard shows PST/PT). */
export function laDateISO(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function mapStatus(s: string): PaymentStatus {
  const t = s.toLowerCase()
  if (t === 'paid' || t === 'released') return 'paid'
  if (t === 'processing' || t === 'in transit') return 'processing'
  if (/fail|cancel|revers|return/.test(t)) return 'failed'
  return 'pending'
}

function mapType(s: string): { type: PaymentType; label: string } {
  const t = s.toLowerCase()
  if (t.startsWith('contract')) return { type: 'hourly', label: 'Contracts' }
  if (t.startsWith('incentive')) return { type: 'incentive', label: 'Incentive' }
  if (t.startsWith('work')) return { type: 'work_trial', label: 'Work trial' }
  if (t.startsWith('bonus') || t.startsWith('referral')) return { type: 'incentive', label: s.replace(/\s*\(.*$/, '') }
  return { type: 'other', label: s }
}

function parseRelease(text: string | undefined, now: Date): { date: string | null; kind: 'actual' | 'expected' | null } {
  if (!text) return { date: null, kind: null }
  const t = text.trim()
  const rel = t.match(/^Releases?\s+(today|tomorrow|yesterday)/i)
  if (rel) {
    const base = laDateISO(now)
    const off = rel[1].toLowerCase() === 'tomorrow' ? 1 : rel[1].toLowerCase() === 'yesterday' ? -1 : 0
    return { date: addDays(base, off), kind: 'expected' }
  }
  const m = t.match(new RegExp(`(${FULL_DATE})`, 'i'))
  const date = m ? parseSingleDate(m[1].replace(/,\s*/, ', '), now) : null
  const kind = /^(released|sent|paid|arrived)/i.test(t) ? 'actual' : 'expected'
  return { date, kind }
}

/** Human-readable reason a payment line could not be parsed. */
export function explainRow(line: string): string {
  const t = line.replace(/\t+/g, ' ').trim()
  const date = t.match(new RegExp(`^(${FULL_DATE})\\s*`, 'i'))
  if (!date) return 'it does not start with a payout date like "Dec 2, 2026"'
  if (!/-?\$\s?[\d,]+(?:\.\d{1,2})?\s*$/.test(t)) return 'no earned amount (like "$281.24") at the end'
  const rest = t.slice(date[0].length)
  const type = rest.match(new RegExp(`(${TYPE_ALT})`, 'i'))
  if (!type) return 'unknown payment type (expected "Contracts (Mon D - Mon D)", "Incentive" or "Work trial")'
  const afterType = rest.slice((type.index ?? 0) + type[0].length).trim()
  if (!new RegExp(`^(${STATUS_ALT})`, 'i').test(afterType)) return `unknown status after the type (expected Upcoming, Released or Paid): "${afterType.slice(0, 20)}"`
  if (type[2] !== undefined || /contract/i.test(type[0])) {
    const period = type[0].match(/\(([^)]*)\)/)?.[1]
    if (period && !/\d/.test(period)) return `the work period "${period}" has no dates`
  }
  return 'the release text or hours are in an unexpected format'
}

/** Rows whose type column is not one we know: date · contract+type · status · release · hours · amount. */
const FALLBACK_RE = new RegExp(
  `^(${FULL_DATE})\\s*([\\s\\S]+?)\\s*(${STATUS_ALT})\\s*(${RELEASE_ALT})?\\s*(-|\\u2014|\\d+(?:\\.\\d+)?)?\\s*(-?\\$\\s?[\\d,]+(?:\\.\\d{1,2})?)\\s*$`,
  'i',
)

/** Split "contract + type" when the type is unfamiliar: by cell (newline) or by a glued word boundary. */
function splitContractType(mid: string): { contract: string; type: string } {
  const cells = mid.split('\n').map((c) => c.trim()).filter(Boolean)
  if (cells.length >= 2) return { contract: cells.slice(0, -1).join(' '), type: cells[cells.length - 1] }
  const glue = [...mid.matchAll(/[a-z0-9)\]](?=[A-Z])/g)]
  if (glue.length) {
    const at = (glue[glue.length - 1].index ?? 0) + 1
    return { contract: mid.slice(0, at).trim(), type: mid.slice(at).trim() }
  }
  return { contract: mid.trim(), type: 'Unknown type' }
}

export function parseRow(line: string, now: Date): ParsedPayment | null {
  const m = line.replace(/\t+/g, ' ').match(ROW_RE)
  if (!m) return parseUnknownTypeRow(line, now)
  const [, payoutRaw, contractRaw, typeRaw, periodA, periodB, statusRaw, releaseRaw, hoursRaw, moneyRaw] = m
  const payoutDate = parseSingleDate(payoutRaw.replace(/,\s*/, ', '), now)
  const { type, label } = mapType(typeRaw)
  const periodText = periodA ?? periodB
  let workStart: string | null = null
  let workEnd: string | null = null
  if (periodText) {
    const r = parseRange(periodText, now, payoutDate)
    if (r) {
      workStart = r.start
      workEnd = r.end
    } else {
      const single = parseSingleDate(periodText, now)
      if (single) workStart = workEnd = single
    }
  }
  const status = mapStatus(statusRaw)
  const release = parseRelease(releaseRaw, now)
  const hours = hoursRaw && /\d/.test(hoursRaw) ? Number(hoursRaw) : null
  const cents = parseMoneyToCents(moneyRaw.replace(/\s/g, ''))
  if (cents === null || !payoutDate) return null
  return {
    contract: contractRaw.replace(/\s+/g, ' ').trim(),
    type,
    typeLabel: label,
    workStart,
    workEnd,
    payoutDate,
    hours: type === 'hourly' ? hours ?? 0 : hours,
    earningsCents: cents,
    rateCents: null,
    status,
    statusLabel: statusRaw,
    releaseDate: release.date,
    releaseKind: release.kind,
    releaseText: releaseRaw?.replace(/\s+/g, ' ').trim() ?? null,
    raw: line.replace(/\n/g, ' ').trim(),
  }
}

function parseUnknownTypeRow(line: string, now: Date): ParsedPayment | null {
  const m = line.replace(/\t+/g, ' ').match(FALLBACK_RE)
  if (!m) return null
  const [, payoutRaw, mid, statusRaw, releaseRaw, hoursRaw, moneyRaw] = m
  // If the middle actually contains a known type, the strict pattern failed for another reason.
  if (new RegExp(`(${TYPE_ALT})\\s*$`, 'i').test(mid.trim())) return null
  const { contract, type: typeText } = splitContractType(mid)
  const payoutDate = parseSingleDate(payoutRaw.replace(/\s+/g, ' ').replace(/,\s*/, ', '), now)
  const cents = parseMoneyToCents(moneyRaw.replace(/\s/g, ''))
  if (!payoutDate || cents === null || !contract) return null
  const release = parseRelease(releaseRaw?.replace(/\s+/g, ' '), now)
  const period = typeText.match(/\(([^)]*\d[^)]*)\)/)?.[1]
  const range = period ? parseRange(period, now, payoutDate) : null
  return {
    contract: contract.replace(/\s+/g, ' '),
    type: 'other',
    typeLabel: typeText.replace(/\s*\(.*$/, ''),
    workStart: range?.start ?? null,
    workEnd: range?.end ?? null,
    payoutDate,
    hours: hoursRaw && /\d/.test(hoursRaw) ? Number(hoursRaw) : null,
    earningsCents: cents,
    rateCents: null,
    status: mapStatus(statusRaw),
    statusLabel: statusRaw,
    releaseDate: release.date,
    releaseKind: release.kind,
    releaseText: releaseRaw?.replace(/\s+/g, ' ').trim() ?? null,
    unknownType: true,
    raw: line.replace(/\n/g, ' ').trim(),
  }
}

function moneyAfter(lines: string[], i: number, span = 3): { cents: number; at: number; approx: boolean } | null {
  for (let j = i; j < Math.min(lines.length, i + span + 1); j++) {
    const mm = findMoney(lines[j])
    if (mm.length) return { cents: mm[0].cents, at: j, approx: /~|≈|approx/i.test(lines[j]) }
  }
  return null
}

/** Returns null when the text does not look like the the dashboard dashboard row format. */
export function parseCopiedDashboard(text: string, now: Date = new Date()): ParseResult | null {
  const lines = normalizeText(text)
  const isHeaderAt = (i: number) => {
    const window = lines.slice(i, i + HEADER_CELLS.length).map((l) => l.toLowerCase().trim())
    const joined = lines[i].toLowerCase()
    return window.join('|') === HEADER_CELLS.join('|') || HEADER_CELLS.every((h) => joined.includes(h))
  }

  // The owner may paste several pages of the table in one go (page 1, then
  // page 2, ...). Each copy carries its own header and footer, so read rows
  // from every table section, not just the first one.
  const headers: number[] = []
  for (let i = 0; i < lines.length; i++) if (isHeaderAt(i)) headers.push(i)
  const headerAt = headers.length ? headers[0] : -1
  const firstFooter = lines.findIndex((l) => FOOTER_RE.test(l))
  const body = headerAt < 0 && firstFooter >= 0 ? lines.slice(0, firstFooter) : lines

  // Rows arrive either run together on one line or one cell per line (depends on
  // the browser). Group lines from a payout-date start until the amount cell.
  const payments: ParsedPayment[] = []
  const unparsed: string[] = []
  const DATE_START = new RegExp(`^${FULL_DATE}`, 'i')
  const ENDS_WITH_MONEY = /-?\$\s?[\d,]+(?:\.\d{1,2})?\s*$/
  // A row seen in an earlier section is the same page pasted twice: keep one.
  const seenBefore = new Set<string>()
  let seenHere = new Set<string>()
  let buf: string[] = []
  const flush = () => {
    if (!buf.length) return
    const joined = buf.join('\n')
    const key = buf.join(' ').replace(/\s+/g, ' ').trim().toLowerCase()
    buf = []
    if (seenBefore.has(key)) return
    seenHere.add(key)
    const p = parseRow(joined, now)
    if (p) payments.push(p)
    else unparsed.push(`${joined.split('\n').join(' \u00b7 ')}  \u2192  ${explainRow(joined)}`)
  }
  const sections: Array<[number, number]> = headers.length
    ? headers.map((h, k) => [h + HEADER_SPAN(lines, h), k + 1 < headers.length ? headers[k + 1] : lines.length])
    : [[0, body.length]]
  for (const [from, to] of sections) {
    for (let i = from; i < to; i++) {
      const line = body[i].trim()
      if (FOOTER_RE.test(line)) break
      if (!line || /^[*\u2022]\s*$/.test(line)) continue
      if (!buf.length) {
        if (!DATE_START.test(line)) continue
      } else if (
        new RegExp(`^${FULL_DATE}\\s*$`, 'i').test(line) &&
        buf.length >= 5 &&
        !/^(releases?|released|sent|paid|expected|estimated|arrives?|arrived)(\s+on)?$/i.test(buf[buf.length - 1])
      ) {
        // A new bare payout date while the previous row never reached an amount
        flush()
      }
      buf.push(line)
      if (ENDS_WITH_MONEY.test(line)) flush()
      else if (buf.length > 12) flush()
    }
    flush()
    for (const k of seenHere) seenBefore.add(k)
    seenHere = new Set()
  }
  if (!payments.length && headerAt < 0) return null

  // ---------------------------------------------------------- summary cards
  const pre = headerAt >= 0 ? body.slice(0, headerAt) : body
  const summary: ParsedSummary = {
    lifetimeCents: null,
    currentPayoutCents: null,
    nextPayoutCents: null,
    nextPayoutDate: null,
    paidThisMonthCents: null,
    payoutCount: null,
    stripeStatus: null,
    payoutInTransit: null,
    nextPayoutStatus: null,
    nextPayoutApprox: false,
    chartTotalCents: null,
    importedAt: now.getTime(),
  }
  const idx = (re: RegExp, from = 0) => {
    for (let i = from; i < pre.length; i++) if (re.test(pre[i])) return i
    return -1
  }
  const life = idx(/^total earnings to date/i)
  if (life >= 0) summary.lifetimeCents = moneyAfter(pre, life, 1)?.cents ?? null
  const stripe = idx(/^stripe\b/i)
  if (stripe >= 0) summary.stripeStatus = pre[stripe]
  const cur = idx(/^current payout$/i)
  if (cur >= 0) {
    const m = moneyAfter(pre, cur + 1, 1)
    summary.currentPayoutCents = m?.cents ?? null
    const t = pre.slice(cur + 1, cur + 4).find((l) => /payout in transit|in transit/i.test(l))
    summary.payoutInTransit = t ?? null
  }
  const next = idx(/^next payout$/i)
  if (next >= 0) {
    const m = moneyAfter(pre, next + 1, 2)
    summary.nextPayoutCents = m?.cents ?? null
    summary.nextPayoutApprox = !!m?.approx
    const st = pre.slice(next + 1, next + 3).find((l) => /^(upcoming|pending|processing|paid|scheduled)$/i.test(l))
    summary.nextPayoutStatus = st ?? null
    const est = pre.slice(next + 1, next + 5).find((l) => /^(estimated|expected|on)\s/i.test(l))
    if (est) summary.nextPayoutDate = parseSingleDate(est.replace(/^(estimated|expected|on)\s+/i, ''), now)
  }
  const ptm = idx(/^paid this month$/i)
  if (ptm >= 0) {
    summary.paidThisMonthCents = moneyAfter(pre, ptm + 1, 2)?.cents ?? null
    const c = pre.slice(ptm + 1, ptm + 5).map((l) => l.match(/^(\d+)\s+payouts?$/i)).find(Boolean)
    summary.payoutCount = c ? Number(c[1]) : null
  }
  const chart = idx(/^earnings over time$/i)
  if (chart >= 0) summary.chartTotalCents = moneyAfter(pre, chart + 1, 1)?.cents ?? null

  // ---------------------------------------------------------- projects
  // Repeated structure: name / "$X Total earnings" / Active|Inactive
  const projects: ParsedProject[] = []
  for (let i = 1; i < pre.length - 1; i++) {
    // "$X Total earnings" on one line, or "$X" then "Total earnings" on the next
    let m = pre[i].match(/^(-?\$[\d,]+(?:\.\d{1,2})?)\s*total earnings$/i)
    let statusAt = i + 1
    if (!m && /^total earnings$/i.test(pre[i + 1] ?? '')) {
      m = pre[i].match(/^(-?\$[\d,]+(?:\.\d{1,2})?)$/)
      statusAt = i + 2
    }
    if (!m) continue
    const name = pre[i - 1]
    if (!name || findMoney(name).length || /^(earnings over time|total earnings|paid|upcoming|data refreshes)/i.test(name)) continue
    const st = pre[statusAt] ?? ''
    projects.push({
      name: name.trim(),
      earningsCents: parseMoneyToCents(m[1]),
      active: /^active$/i.test(st) ? true : /^inactive$/i.test(st) ? false : null,
    })
  }

  // ---------------------------------------------------------- report gaps
  const missing: string[] = []
  if (summary.lifetimeCents === null) missing.push('Total earnings to date')
  if (cur >= 0 && summary.currentPayoutCents === null) missing.push('Current payout amount')
  if (next >= 0 && summary.nextPayoutCents === null) missing.push('Next payout amount')
  if (next >= 0 && summary.nextPayoutDate === null) missing.push('Next payout date')
  if (ptm >= 0 && summary.paidThisMonthCents === null) missing.push('Paid this month')
  if (chart >= 0 && summary.chartTotalCents === null) missing.push('Earnings over time total')
  if (headerAt < 0) missing.push('Payments table header')
  summary.missing = missing

  const warnings: string[] = []
  if (missing.length) warnings.push(`Could not read: ${missing.join(', ')}.`)
  const unknownTypes = payments.filter((p) => p.unknownType)
  if (unknownTypes.length) {
    warnings.push(
      `${unknownTypes.length} row(s) have a payment type this app does not know yet (${[...new Set(unknownTypes.map((p) => `"${p.typeLabel}"`))].join(', ')}). They are imported as "Other" with the dashboard's label kept; no hourly rate is inferred.`,
    )
  }
  if (unparsed.length) warnings.push(`${unparsed.length} payment line(s) could not be understood and were not imported.`)
  if (headerAt >= 0 && !payments.length) warnings.push('The payments table was found but contained no readable rows.')
  return { summary, projects, payments, warnings, unparsedLines: unparsed }
}
