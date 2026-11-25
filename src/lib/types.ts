// Core domain types. All money is stored as integer cents.
// Dates are ISO calendar dates ("YYYY-MM-DD") with no time zone.

export type PaymentType = 'hourly' | 'incentive' | 'work_trial' | 'other'
export type PaymentStatus = 'paid' | 'pending' | 'processing' | 'failed' | 'other'

export interface Payment {
  id: string
  contract: string
  type: PaymentType
  /** Original type label from the dashboard, e.g. "Hourly", "Bonus" */
  typeLabel?: string
  workStart: string | null
  workEnd: string | null
  payoutDate: string | null
  hours: number | null
  earningsCents: number
  /** Hourly rate in cents (null for incentives / work trials) */
  rateCents: number | null
  /** true when the rate was inferred from earnings / hours */
  rateInferred?: boolean
  status: PaymentStatus
  statusLabel?: string
  /** Actual (paid) or expected release date */
  releaseDate: string | null
  releaseKind?: 'actual' | 'expected' | null
  /** Original dashboard status / release text, e.g. "Releases today (PST)" (audit trail) */
  releaseText?: string | null
  /** Contract name exactly as the dashboard shows it, when it differs from `contract` (alias) */
  sourceContract?: string | null
  notes?: string
  /** Manual month split for periods crossing months (overrides day-based estimate) */
  allocation?: MonthAllocation[] | null
  source: 'import' | 'manual'
  createdAt: number
  updatedAt: number
  lastImportId?: string | null
}

export interface MonthAllocation {
  month: string // YYYY-MM
  cents: number
  hours?: number
}

export type PaymentInput = Omit<Payment, 'id' | 'createdAt' | 'updatedAt' | 'source'> & {
  source?: Payment['source']
}

/** A payment row extracted by the parser, before matching */
export interface ParsedPayment {
  contract: string
  type: PaymentType
  typeLabel: string
  workStart: string | null
  workEnd: string | null
  payoutDate: string | null
  hours: number | null
  earningsCents: number
  rateCents: number | null
  status: PaymentStatus
  statusLabel: string
  releaseDate: string | null
  releaseKind: 'actual' | 'expected' | null
  releaseText?: string | null
  /** Set by matching when the contract name was mapped through an alias */
  sourceContract?: string | null
  /** Payment type column not recognised; imported as "other" with the original label */
  unknownType?: boolean
  /** Raw source text for the row (for previews) */
  raw: string
}

export interface ParsedProject {
  name: string
  earningsCents: number | null
  active: boolean | null
}

export interface ParsedSummary {
  lifetimeCents: number | null
  currentPayoutCents: number | null
  nextPayoutCents: number | null
  nextPayoutDate: string | null
  paidThisMonthCents: number | null
  payoutCount: number | null
  /** Optional dashboard details (kept as separate source values) */
  stripeStatus?: string | null
  payoutInTransit?: string | null
  nextPayoutStatus?: string | null
  nextPayoutApprox?: boolean
  chartTotalCents?: number | null
  /** Fields the parser expected but could not read */
  missing?: string[]
  importedAt?: number
}

export interface ParseResult {
  summary: ParsedSummary
  projects: ParsedProject[]
  payments: ParsedPayment[]
  warnings: string[]
  /** Lines that looked like data but could not be understood */
  unparsedLines: string[]
}

export interface Settings {
  displayName?: string
  hourlyRates: number[] // dollars, e.g. [65, 85]
  cycleStartDay: number // default 21
  rateTolerancePct: number // default 3
  /** Dashboard contract name → name used in your records, e.g. long dashboard names → short names */
  contractAliases?: Record<string, string>
  /** Project → contract names (manual; overrides the learned mapping) */
  projectContracts?: Record<string, string[]>
  /** Google Sheets reporting copy */
  sheetsSpreadsheetId?: string | null
  /** Display name of the chosen spreadsheet */
  sheetsSpreadsheetName?: string | null
  /** true once the spreadsheet was chosen in Google's picker (or created by Rashio) */
  sheetsFileAccess?: boolean
  sheetsAutoSync?: boolean
  sheetsLastSyncAt?: number | null
  sheetsLastError?: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  hourlyRates: [65, 85],
  cycleStartDay: 21,
  rateTolerancePct: 3,
}

export interface SyncMeta {
  revision: number
  /** Last time payment records were synchronised from a dashboard paste */
  lastSyncAt: number | null
  /** Last time the dashboard summary / project cards were saved */
  lastSummaryAt?: number | null
  /** Project → contracts mapping learned automatically from exact totals */
  projectMap?: Record<string, string[]>
  /** The user accepted this exact tracked-vs-dashboard difference (warning hidden while both totals stay the same) */
  reconAccepted?: { trackedCents: number; reportedCents: number; at: number } | null
  lastImportId: string | null
  summary: ParsedSummary | null
  projects: ParsedProject[]
}

export interface ImportRecord {
  id: string
  createdAt: number
  createdIds: string[]
  /** Full previous state of each updated payment, for undo */
  before: Payment[]
  /** Payment states written by this import, used to detect later edits before undo */
  afterUpdatedAt: Record<string, number>
  counts: { created: number; updated: number; unchanged: number; ambiguous: number; skipped: number }
  summary: ParsedSummary | null
  reconciliation: ReconciliationLine[]
  undone: boolean
  undoneAt?: number | null
  /** Tracked total before and after this import (cents) */
  totalBeforeCents?: number
  totalAfterCents?: number
  /** Dashboard summary / projects / sync times as they were before this import (restored by undo) */
  metaBefore?: {
    summary: ParsedSummary | null
    projects: ParsedProject[]
    projectMap?: Record<string, string[]>
    lastSyncAt: number | null
    lastSummaryAt?: number | null
  } | null
  revisionBefore: number
  revisionAfter: number
}

export interface ReconciliationLine {
  label: string
  expectedCents: number | null
  actualCents: number
  diffCents: number | null
  note?: string
}
