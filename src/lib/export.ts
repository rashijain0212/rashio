import type { Payment } from './types'
import type { Backup } from './store'

const COLS: (keyof Payment)[] = [
  'id', 'contract', 'type', 'typeLabel', 'workStart', 'workEnd', 'payoutDate', 'hours', 'earningsCents', 'rateCents',
  'status', 'statusLabel', 'releaseDate', 'releaseKind', 'notes', 'source',
]

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  // Neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(payments: Payment[]): string {
  const header = [...COLS.filter((c) => c !== 'earningsCents' && c !== 'rateCents'), 'earnings', 'rate']
  const lines = [header.join(',')]
  for (const p of payments) {
    const row = COLS.filter((c) => c !== 'earningsCents' && c !== 'rateCents').map((c) => csvCell(p[c]))
    row.push((p.earningsCents / 100).toFixed(2), p.rateCents ? (p.rateCents / 100).toFixed(2) : '')
    lines.push(row.join(','))
  }
  return lines.join('\n') + '\n'
}

export function toBackup(payments: Payment[], extra: Partial<Backup> = {}): Backup {
  return { app: 'rashio', version: 1, exportedAt: new Date().toISOString(), payments, ...extra }
}

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
