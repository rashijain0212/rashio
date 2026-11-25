// SYNTHETIC fixtures only — not real earnings data.

export const NOW = new Date(2026, 10, 25) // Nov 25, 2026

/** One cell per line, as produced by copying a rendered web table. */
export const PAGE_LINES = `Brand
Home
Jobs
Earnings
Messages
Earnings
Total earnings
$2,470.00
Current payout
$1,250.00
Next payout
$1,250.00
Dec 2, 2026
Paid this month
$1,220.00
Payouts
4
Earnings over time
Jan
Feb
Mar
$0
$1k
$2k
Projects
Atlas
$1,332.50
Active
Orion
$1,137.50
Inactive
Payout history
Payout date
Contract
Type
Work period
Hours
Earnings
Status
Dec 2, 2026
Atlas Writer
Hourly
Nov 21 - Nov 27, 2026
10.5 hrs
$892.50
Upcoming
Dec 2, 2026
Orion Coding
Hourly
Nov 21 - Nov 27, 2026
5.5 hrs
$357.50
Upcoming
Nov 25, 2026
Atlas Writer
Incentive
Nov 12, 2026
$215.00
Paid
Released Nov 24, 2026
Nov 25, 2026
Atlas Writer
Incentive
Nov 12, 2026
$125.00
Paid
Released Nov 24, 2026
Nov 18, 2026
Orion Coding
Hourly
Oct 31 - Nov 6, 2026
12 hrs
$780.00
Paid
Released Nov 17, 2026
Nov 4, 2026
Atlas Writer
Work trial
Oct 28, 2026
$100.00
Paid
Privacy
Terms
`

/** Same data as tab-separated rows (copied from a spreadsheet-like table). */
export const PAGE_TABS = [
  'Total earnings\t$2,470.00',
  'Current payout\t$1,250.00',
  'Next payout\t$1,250.00 on Dec 2, 2026',
  'Paid this month\t$1,220.00',
  'Payouts\t4',
  'Payout history',
  'Payout date\tContract\tType\tWork period\tHours\tEarnings\tStatus',
  'Dec 2, 2026\tAtlas Writer\tHourly\tNov 21 - Nov 27, 2026\t10.5\t$892.50\tUpcoming',
  'Dec 2, 2026\tOrion Coding\tHourly\tNov 21 - Nov 27, 2026\t5.5\t$357.50\tUpcoming',
  'Nov 25, 2026\tAtlas Writer\tIncentive\tNov 12, 2026\t\t$215.00\tPaid · Nov 24, 2026',
  'Nov 25, 2026\tAtlas Writer\tIncentive\tNov 12, 2026\t\t$125.00\tPaid · Nov 24, 2026',
  'Nov 18, 2026\tOrion Coding\tHourly\tOct 31 - Nov 6, 2026\t12\t$780.00\tPaid · Nov 17, 2026',
  'Nov 4, 2026\tAtlas Writer\tWork trial\tOct 28, 2026\t\t$100.00\tPaid',
].join('\n')

/** Short dates without years. */
export const PAGE_NO_YEARS = `Payout history
Dec 2
Atlas Writer
Hourly
Nov 21 - 27
10.5 hrs
$892.50
Upcoming
Jan 7
Orion Coding
Hourly
Dec 28 - Jan 3
4 hrs
$260.00
Upcoming
`

export function pageWith(rows: string[]): string {
  return ['Payout history', 'Payout date\tContract\tType\tWork period\tHours\tEarnings\tStatus', ...rows].join('\n')
}
