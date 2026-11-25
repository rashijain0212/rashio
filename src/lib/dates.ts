// Pure calendar-date helpers. Dates are "YYYY-MM-DD" strings; arithmetic is done
// in UTC so results never depend on the viewer's time zone.

export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

export function isValidYMD(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  return d <= daysInMonth(y, m)
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

export function toDayNumber(iso: string): number {
  const { y, m, d } = parseISO(iso)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}

export function fromDayNumber(n: number): string {
  const dt = new Date(n * 86400000)
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(toDayNumber(iso) + days)
}

/** Inclusive number of days between a and b */
export function daysInclusive(a: string, b: string): number {
  return toDayNumber(b) - toDayNumber(a) + 1
}

export function monthIndex(token: string): number | null {
  const i = MONTHS.indexOf(token.slice(0, 3).toLowerCase())
  return i >= 0 ? i + 1 : null
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function monthLabel(key: string, short = false): string {
  const [y, m] = key.split('-').map(Number)
  const name = MONTH_NAMES[m - 1]
  return short ? `${name.slice(0, 3)} ${String(y).slice(2)}` : `${name} ${y}`
}

export function formatDate(iso: string | null | undefined, withYear = true): string {
  if (!iso) return '—'
  const { y, m, d } = parseISO(iso)
  return withYear ? `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}, ${y}` : `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}`
}

export function formatRange(a: string | null, b: string | null): string {
  if (!a && !b) return '—'
  if (!a || !b || a === b) return formatDate(a ?? b)
  const pa = parseISO(a)
  const pb = parseISO(b)
  if (pa.y === pb.y) return `${formatDate(a, false)} – ${formatDate(b, false)}, ${pb.y}`
  return `${formatDate(a)} – ${formatDate(b)}`
}

export function todayISO(now: Date = new Date()): string {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** First/last day of a calendar month key "YYYY-MM" */
export function monthBounds(key: string): [string, string] {
  const [y, m] = key.split('-').map(Number)
  return [toISO(y, m, 1), toISO(y, m, daysInMonth(y, m))]
}

/**
 * Pay cycle containing `iso`, for cycles starting on `startDay` (e.g. 21st → 20th).
 * Start days beyond a month's length clamp to the last day of that month.
 * Returns the cycle key (start date) and inclusive bounds.
 */
export function cycleFor(iso: string, startDay: number): { key: string; start: string; end: string } {
  const { y, m, d } = parseISO(iso)
  const startIn = (yy: number, mm: number) => toISO(yy, mm, Math.min(startDay, daysInMonth(yy, mm)))
  let sy = y
  let sm = m
  const thisStart = startIn(y, m)
  if (iso < thisStart) {
    sm -= 1
    if (sm === 0) {
      sm = 12
      sy -= 1
    }
  }
  void d
  const start = startIn(sy, sm)
  let ny = sy
  let nm = sm + 1
  if (nm === 13) {
    nm = 1
    ny += 1
  }
  const end = addDays(startIn(ny, nm), -1)
  return { key: start, start, end }
}

export function cycleLabel(start: string, end: string): string {
  return `${formatDate(start, false)} – ${formatDate(end, false)} ${parseISO(end).y}`
}

/** All month keys from a to b inclusive */
export function monthRange(aKey: string, bKey: string): string[] {
  const out: string[] = []
  let [y, m] = aKey.split('-').map(Number)
  const [by, bm] = bKey.split('-').map(Number)
  while (y < by || (y === by && m <= bm)) {
    out.push(`${y}-${pad(m)}`)
    m += 1
    if (m === 13) {
      m = 1
      y += 1
    }
  }
  return out
}

export function ordinal(n: number): string {
  const sfx = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (sfx[(v - 20) % 10] || sfx[v] || sfx[0])
}
