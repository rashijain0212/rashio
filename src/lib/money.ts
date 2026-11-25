/** Parse a money string like "$1,234.56", "-$5", "(12.30)", "1234" into integer cents. */
export function parseMoneyToCents(input: string): number | null {
  const s = input.trim()
  const m = s.match(/^(\()?\s*([-−–+])?\s*(?:US)?\$?\s*([-−–])?\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?\s*(\))?$/)
  if (!m) return null
  const [, openParen, sign1, sign2, whole, frac, closeParen] = m
  if (whole === undefined && frac === undefined) return null
  const w = whole ? parseInt(whole.replace(/,/g, ''), 10) : 0
  const f = frac ? parseInt(frac.padEnd(2, '0'), 10) : 0
  let cents = w * 100 + f
  const negative = (openParen && closeParen) || /[-−–]/.test(sign1 ?? '') || /[-−–]/.test(sign2 ?? '')
  if (negative) cents = -cents
  return cents
}

/** Find every money token in text, in order. Only tokens with a "$" count. */
export function findMoney(text: string): { cents: number; index: number; raw: string; perHour: boolean }[] {
  const out: { cents: number; index: number; raw: string; perHour: boolean }[] = []
  const re = /([-−–]?\s?\$\s?[-−–]?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|[-−–]?\s?\$\s?\d+(?:\.\d{1,2})?)(\s*(?:\/\s*(?:hr|hour|h)\b|per\s+hour))?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const cents = parseMoneyToCents(m[1].replace(/\s/g, ''))
    if (cents !== null) out.push({ cents, index: m.index, raw: m[0], perHour: Boolean(m[2]) })
  }
  return out
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return usd.format(cents / 100)
}

export function formatCentsCompact(cents: number): string {
  return usdCompact.format(cents / 100)
}

/** Divide cents by hours, returning cents/hour (rounded). */
export function centsPerHour(cents: number, hours: number): number | null {
  if (!hours || hours <= 0) return null
  return Math.round(cents / hours)
}

/**
 * Split `total` cents into integer parts proportional to `weights`, so that the
 * parts always sum exactly to `total` (largest-remainder method).
 */
export function splitCents(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0)
  if (sumW <= 0) return weights.map((_, i) => (i === 0 ? total : 0))
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  const raw = weights.map((w) => (abs * w) / sumW)
  const floors = raw.map(Math.floor)
  let remainder = abs - floors.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (remainder <= 0) break
    floors[i] += 1
    remainder -= 1
  }
  return floors.map((v) => v * sign)
}
