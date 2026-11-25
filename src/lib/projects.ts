// Project ↔ contract mapping. The dashboard reports totals per project, payments carry
// contract names. A mapping is learned when a project's reported total equals the
// tracked total of a unique set of contracts (exact to the cent), and can be set
// manually in Settings. The dashboard's project totals are kept separately.

import type { ParsedProject, Payment } from './types'
import { normName } from './sync'

export function contractTotals(payments: Payment[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of payments) if (p.status !== 'failed') m.set(p.contract, (m.get(p.contract) ?? 0) + p.earningsCents)
  return m
}

/** Learn project → contracts where exactly one combination (≤3 contracts) matches the project total. */
export function inferProjectMap(projects: ParsedProject[], payments: Payment[]): Record<string, string[]> {
  const totals = [...contractTotals(payments).entries()]
  const out: Record<string, string[]> = {}
  const taken = new Set<string>()
  // Exact name matches first (e.g. a project and contract both called "Trial Co")
  for (const p of projects) {
    const same = totals.find(([c]) => normName(c) === normName(p.name))
    if (same) {
      out[p.name] = [same[0]]
      taken.add(same[0])
    }
  }
  for (const p of projects) {
    if (out[p.name] || p.earningsCents === null) continue
    const avail = totals.filter(([c]) => !taken.has(c))
    const hits: string[][] = []
    const n = avail.length
    for (let a = 0; a < n; a++) {
      if (avail[a][1] === p.earningsCents) hits.push([avail[a][0]])
      for (let b = a + 1; b < n; b++) {
        if (avail[a][1] + avail[b][1] === p.earningsCents) hits.push([avail[a][0], avail[b][0]])
        for (let c = b + 1; c < n; c++) {
          if (avail[a][1] + avail[b][1] + avail[c][1] === p.earningsCents) hits.push([avail[a][0], avail[b][0], avail[c][0]])
        }
      }
    }
    if (hits.length === 1) {
      out[p.name] = hits[0]
      hits[0].forEach((c) => taken.add(c))
    }
  }
  return out
}

export interface ProjectRow {
  name: string
  contracts: string[]
  trackedCents: number | null
  reportedCents: number | null
  active: boolean | null
  source: 'manual' | 'learned' | 'none'
}

export function projectRows(
  projects: ParsedProject[],
  payments: Payment[],
  manual: Record<string, string[]> = {},
  learned: Record<string, string[]> = {},
): ProjectRow[] {
  const totals = contractTotals(payments)
  const names = [...new Set([...projects.map((p) => p.name), ...Object.keys(manual)])]
  return names.map((name) => {
    const mp = projects.find((p) => p.name === name)
    const contracts = manual[name]?.length ? manual[name] : learned[name] ?? []
    const resolved = contracts.map((c) => [...totals.keys()].find((k) => normName(k) === normName(c)) ?? c)
    return {
      name,
      contracts: resolved,
      trackedCents: resolved.length ? resolved.reduce((a, c) => a + (totals.get(c) ?? 0), 0) : null,
      reportedCents: mp?.earningsCents ?? null,
      active: mp?.active ?? null,
      source: manual[name]?.length ? 'manual' : learned[name]?.length ? 'learned' : 'none',
    }
  })
}
