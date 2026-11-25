// DEV-ONLY synthetic dataset for visual previews (?demo). Never real data.
import type { Payment, SyncMeta } from '@/lib/types'

let n = 0
function p(x: Partial<Payment>): Payment {
  n++
  return {
    id: `demo${n}`, contract: 'Atlas Writer', type: 'hourly', workStart: null, workEnd: null, payoutDate: null, hours: null,
    earningsCents: 0, rateCents: null, status: 'paid', releaseDate: null, source: 'import', createdAt: 0, updatedAt: 0, ...x,
  }
}

export const demoPayments: Payment[] = [
  p({ type: 'incentive', contract: 'Orion Coding', workStart: '2026-09-21', workEnd: '2026-09-21', payoutDate: '2026-09-23', earningsCents: 40000, releaseDate: '2026-09-23', releaseKind: 'actual' }),
  p({ contract: 'Orion Coding', workStart: '2026-09-24', workEnd: '2026-09-30', payoutDate: '2026-10-05', hours: 18.5, earningsCents: 157250, rateCents: 8500, rateInferred: true, releaseDate: '2026-10-05' }),
  p({ contract: 'Orion Coding', workStart: '2026-09-29', workEnd: '2026-10-05', payoutDate: '2026-10-12', hours: 9.2, earningsCents: 78200, rateCents: 8500, releaseDate: '2026-10-12' }),
  p({ contract: 'Atlas Writer', workStart: '2026-10-03', workEnd: '2026-10-09', payoutDate: '2026-10-14', hours: 22, earningsCents: 187000, rateCents: 8500, releaseDate: '2026-10-14' }),
  p({ type: 'work_trial', contract: 'Nova Review', workStart: '2026-10-08', workEnd: '2026-10-08', payoutDate: '2026-10-14', earningsCents: 10000 }),
  p({ type: 'incentive', contract: 'Atlas Writer', workStart: '2026-10-12', workEnd: '2026-10-12', payoutDate: '2026-10-21', earningsCents: 21500 }),
  p({ type: 'incentive', contract: 'Atlas Writer', workStart: '2026-10-12', workEnd: '2026-10-12', payoutDate: '2026-10-21', earningsCents: 12500 }),
  p({ contract: 'Orion Coding', workStart: '2026-10-10', workEnd: '2026-10-16', payoutDate: '2026-10-21', hours: 5.1, earningsCents: 33149, rateCents: 6500 }),
  p({ contract: 'Atlas Writer', workStart: '2026-10-31', workEnd: '2026-11-06', payoutDate: '2026-11-11', hours: 15, earningsCents: 127510, rateCents: 8500 }),
  p({ contract: 'Atlas Writer', workStart: '2026-11-07', workEnd: '2026-11-13', payoutDate: '2026-11-18', hours: 18.42, earningsCents: 156543, rateCents: 8500, status: 'paid' }),
  p({ contract: 'Atlas Writer', workStart: '2026-11-14', workEnd: '2026-11-20', payoutDate: '2026-11-25', hours: 40, earningsCents: 340021, rateCents: 8500, status: 'pending', statusLabel: 'Upcoming', releaseDate: '2026-11-25', releaseKind: 'expected' }),
  p({ contract: 'Vega SWE', workStart: '2026-11-21', workEnd: '2026-11-27', payoutDate: '2026-12-02', hours: 37.34, earningsCents: 317388, rateCents: 8500, status: 'pending', statusLabel: 'Upcoming' }),
  p({ contract: 'Atlas Writer', workStart: '2026-11-21', workEnd: '2026-11-27', payoutDate: '2026-12-02', hours: 2.53, earningsCents: 21521, rateCents: 8500, status: 'pending', statusLabel: 'Upcoming' }),
]

export const demoMeta: SyncMeta = {
  revision: 3,
  lastSyncAt: Date.now() - 3600_000,
  lastImportId: null,
  summary: { lifetimeCents: 1501082, currentPayoutCents: 340021, nextPayoutCents: 338909, nextPayoutDate: '2026-12-02', paidThisMonthCents: 284053, payoutCount: 9 },
  projects: [
    { name: 'Atlas', earningsCents: 866594, active: true },
    { name: 'Orion', earningsCents: 268599, active: false },
    { name: 'Vega', earningsCents: 317388, active: true },
    { name: 'Nova', earningsCents: 10000, active: false },
  ],
}
