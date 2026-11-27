// Comparing tracked payments with the dashboard's totals.
//
// The dashboard shows two kinds of total:
// - "Total earnings to date" (the headline). It also counts work that is not
//   listed as a payment yet, such as hours still being logged this week, so it
//   often runs a little ahead of the list.
// - The itemised totals: the "Earnings over time" chart total and the project
//   cards. These add up the payments the dashboard actually lists.
// When the tracked payments equal an itemised total, every listed payment is
// accounted for and the headline's extra amount is only "not listed yet".
import type { ParsedProject, ParsedSummary } from './types'

/** The dashboard's total of listed payments: the chart total, else the project cards' sum. */
export function itemisedCents(summary: ParsedSummary | null | undefined, projects: ParsedProject[] = []): number | null {
  if (summary?.chartTotalCents != null) return summary.chartTotalCents
  const known = projects.filter((p) => p.earningsCents != null)
  return known.length ? known.reduce((a, p) => a + (p.earningsCents ?? 0), 0) : null
}

export interface TotalsComparison {
  /** Headline "Total earnings to date" */
  reported: number | null
  /** Chart total or project-card sum */
  itemised: number | null
  /** Difference that needs attention (headline − tracked); 0 when every listed payment is tracked */
  diff: number | null
  /** Amount the headline is ahead of the listed payments (shown as a note, not a warning) */
  unlisted: number
}

export function compareTotals(trackedCents: number, summary: ParsedSummary | null | undefined, projects: ParsedProject[] = []): TotalsComparison {
  const reported = summary?.lifetimeCents ?? null
  const itemised = itemisedCents(summary, projects)
  if (reported === null) return { reported, itemised, diff: null, unlisted: 0 }
  if (itemised === trackedCents && reported > trackedCents) return { reported, itemised, diff: 0, unlisted: reported - trackedCents }
  return { reported, itemised, diff: reported - trackedCents, unlisted: 0 }
}
