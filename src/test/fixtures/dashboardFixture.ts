// SYNTHETIC fixtures that reproduce the exact structure of a earnings page
// copied with Cmd/Ctrl+A → Cmd/Ctrl+C (cells of a row run together on one line).
// Names and amounts are invented.

export interface Row {
  payout: string // "Dec 2, 2026"
  contract: string
  type: string // "Contracts (Nov 21 - Nov 27)" | "Incentive"
  status: string // Upcoming | Released | Paid
  release: string // "Releases Dec 2, 2026" | "Sent Nov 18, 2026" | "Releases today (PST)"
  hours: string // "3.31" | "-"
  earned: string // "$281.24"
}

export function row(r: Row): string {
  return `${r.payout}${r.contract}${r.type}${r.status}${r.release}${r.hours}${r.earned}`
}

function currentCard(opts: { current?: string; onTheWay?: { label: string; arrives: string } }): string[] {
  return opts.onTheWay
    ? ['Current payout', opts.onTheWay.label, opts.current ?? '$0.00', opts.onTheWay.arrives]
    : ['Current payout', opts.current ?? '$0.00', 'No payout in transit']
}

export function dashboard(opts: {
  lifetime: string
  chart?: string
  current?: string
  /** Current payout card when money is moving, e.g. "On the way" … "Arrives Dec 2" */
  onTheWay?: { label: string; arrives: string }
  next?: string
  nextDate?: string
  paidMonth?: string
  payouts?: number
  projects?: { name: string; total: string; active: boolean }[]
  rows: Row[]
}): string {
  const proj = (opts.projects ?? []).flatMap((p) => [p.name, `${p.total}Total earnings`, p.active ? 'Active' : 'Inactive'])
  return [
    '* Explore', '* Home', '* Referrals', '* Learn', '* Earnings', '* Maven', '* Profile', '', '* ', '* Open user menu', '',
    'Earnings',
    `Total earnings to date${opts.lifetime}`,
    'Stripe connected',
    ...currentCard(opts),
    'Next payout', 'Upcoming', `~${opts.next ?? '$0.05'}`, `Estimated ${opts.nextDate ?? 'Nov 18'}`,
    'Paid this month', 'Paid', opts.paidMonth ?? '$100.00', `${opts.payouts ?? 3} payouts`,
    'Earnings over time', opts.chart ?? opts.lifetime, 'Total earnings',
    'Jan 2026Feb 2026Mar 2026$0$2.8K$5.5K',
    (opts.projects ?? []).map((p) => p.name).join(''),
    'Paid', 'Upcoming', 'Data refreshes every hour.',
    ...proj,
    'Payout date', 'Contract', 'Type', 'Status', 'Hours', 'Earned',
    ...opts.rows.map(row),
    '', '* ', '* ', '', 'Ask Maven', '', '$0',
  ].join('\n')
}

// Base snapshot (synthetic). "Long Name (Agent Work)" is the dashboard's name for the
// historical contract "Agent Work".
export const LONG = 'Acme Engineers (Agent Work Experience)'
export const R = {
  draftCur: { payout: 'Dec 2, 2026', contract: 'Drafter', type: 'Contracts (Nov 21 - Nov 27)', status: 'Upcoming', release: 'Releases Dec 2, 2026', hours: '2.00', earned: '$170.00' },
  seniorCur: { payout: 'Dec 2, 2026', contract: 'Lead Dev', type: 'Contracts (Nov 21 - Nov 27)', status: 'Upcoming', release: 'Releases Dec 2, 2026', hours: '30.00', earned: '$2,550.00' },
  draftPrev: { payout: 'Nov 25, 2026', contract: 'Drafter', type: 'Contracts (Nov 14 - Nov 20)', status: 'Upcoming', release: 'Releases today (PST)', hours: '40.00', earned: '$3,400.00' },
  leadTiny: { payout: 'Nov 25, 2026', contract: 'Lead Dev', type: 'Contracts (Nov 14 - Nov 20)', status: 'Upcoming', release: 'Releases Nov 25, 2026', hours: '0.00', earned: '$0.04' },
  agentInc: { payout: 'Nov 19, 2026', contract: LONG, type: 'Incentive', status: 'Paid', release: 'Sent Nov 18, 2026', hours: '-', earned: '$300.00' },
  agentHrs: { payout: 'Nov 19, 2026', contract: LONG, type: 'Contracts (Nov 7 - Nov 13)', status: 'Paid', release: 'Sent Nov 18, 2026', hours: '5.00', earned: '$325.00' },
  draftInc1: { payout: 'Nov 19, 2026', contract: 'Drafter', type: 'Incentive', status: 'Paid', release: 'Sent Nov 18, 2026', hours: '-', earned: '$125.00' },
  draftInc2: { payout: 'Nov 19, 2026', contract: 'Drafter', type: 'Incentive', status: 'Paid', release: 'Sent Nov 18, 2026', hours: '-', earned: '$215.00' },
} satisfies Record<string, Row>

/**
 * The same page as copied by browsers that put every table cell and card value
 * on its own line (e.g. "Total earnings to date" / "$7,085.04", project cards as
 * name / "$X" / "Total earnings" / "Active", one payment cell per line).
 */
export function dashboardCells(opts: Parameters<typeof dashboard>[0]): string {
  const proj = (opts.projects ?? []).flatMap((p) => [p.name, p.total, 'Total earnings', p.active ? 'Active' : 'Inactive'])
  const cells = (r: Row) => [r.payout, r.contract, r.type, r.status, r.release, r.hours, r.earned]
  return [
    'Explore', 'Home', 'Referrals', 'Learn', 'Earnings', 'Maven', 'Profile', 'Open user menu',
    'Earnings',
    'Total earnings to date', opts.lifetime,
    'Stripe connected',
    ...currentCard(opts),
    'Next payout', 'Upcoming', `~${opts.next ?? '$0.05'}`, `Estimated ${opts.nextDate ?? 'Nov 18'}`,
    'Paid this month', 'Paid', opts.paidMonth ?? '$100.00', `${opts.payouts ?? 3} payouts`,
    'Earnings over time', opts.chart ?? opts.lifetime, 'Total earnings',
    'Jan 2026', 'Feb 2026', '$0', '$2.8K',
    ...(opts.projects ?? []).map((p) => p.name),
    'Paid', 'Upcoming', 'Data refreshes every hour.',
    ...proj,
    'Payout date', 'Contract', 'Type', 'Status', 'Hours', 'Earned',
    ...opts.rows.flatMap(cells),
    'Ask Maven', '$0',
  ].join('\n')
}
