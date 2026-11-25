import type { Payment, PaymentType } from './types'

export interface RateInference {
  rateCents: number | null
  inferred: boolean
}

/**
 * Infer an hourly rate. Reported hours are rounded, so earnings / hours is only
 * approximate: snap to a preferred rate (e.g. $65 / $85) when within tolerance.
 * Incentives and work trials never get a rate.
 */
export function inferRate(opts: {
  type: PaymentType
  earningsCents: number
  hours: number | null
  explicitRateCents?: number | null
  preferredRates: number[] // dollars
  tolerancePct: number
  contractRateCents?: number | null
}): RateInference {
  const { type, earningsCents, hours, explicitRateCents, preferredRates, tolerancePct, contractRateCents } = opts
  if (type !== 'hourly') return { rateCents: null, inferred: false }
  if (explicitRateCents) return { rateCents: explicitRateCents, inferred: false }
  // Tiny 0.00-hour entries: fall back to the contract's known rate.
  if (!hours || hours <= 0.05) {
    return contractRateCents ? { rateCents: contractRateCents, inferred: true } : { rateCents: null, inferred: false }
  }
  const raw = earningsCents / hours
  let best: number | null = null
  let bestDiff = Infinity
  for (const r of preferredRates) {
    const rc = Math.round(r * 100)
    const diff = Math.abs(raw - rc) / rc
    if (diff < bestDiff) {
      bestDiff = diff
      best = rc
    }
  }
  // Rounded hours on short entries can skew the ratio more; widen tolerance.
  const tol = tolerancePct / 100 + (hours < 2 ? 0.05 : 0)
  if (best !== null && bestDiff <= tol) return { rateCents: best, inferred: true }
  if (contractRateCents && Math.abs(raw - contractRateCents) / contractRateCents <= tol) {
    return { rateCents: contractRateCents, inferred: true }
  }
  return { rateCents: Math.round(raw), inferred: true }
}

/** Most common hourly rate already recorded for each contract. */
export function contractRates(payments: Pick<Payment, 'contract' | 'type' | 'rateCents' | 'hours'>[]): Map<string, number> {
  const counts = new Map<string, Map<number, number>>()
  for (const p of payments) {
    if (p.type !== 'hourly' || !p.rateCents || !p.hours || p.hours <= 0.05) continue
    const k = normalizeName(p.contract)
    const m = counts.get(k) ?? new Map<number, number>()
    m.set(p.rateCents, (m.get(p.rateCents) ?? 0) + p.hours)
    counts.set(k, m)
  }
  const out = new Map<string, number>()
  for (const [k, m] of counts) {
    let best = 0
    let bestW = -1
    for (const [rate, w] of m) if (w > bestW) [best, bestW] = [rate, w]
    out.set(k, best)
  }
  return out
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
