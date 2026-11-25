import { useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react'
import type { Payment, PaymentStatus } from '@/lib/types'
import { formatCents } from '@/lib/money'
import { formatDate, formatRange } from '@/lib/dates'
import { StatusBadge, TypeBadge, STATUS_LABEL } from './labels'
import { Table, Td, Th, Empty } from './Table'
import { ActionsMenu } from './ui/menu'
import { lifetimeTotals, workInterval } from '@/lib/calc'
import { cn } from '@/lib/utils'

export type SortKey = 'work' | 'contract' | 'hours' | 'earnings' | 'payout' | 'status'

export function sortPayments(ps: Payment[], key: SortKey, dir: 1 | -1): Payment[] {
  const v = (p: Payment): string | number => {
    switch (key) {
      case 'work': return workInterval(p)?.[0] ?? ''
      case 'contract': return p.contract.toLowerCase()
      case 'hours': return p.hours ?? -1
      case 'earnings': return p.earningsCents
      case 'payout': return p.payoutDate ?? ''
      case 'status': return p.status
    }
  }
  return [...ps].sort((a, b) => {
    const x = v(a)
    const y = v(b)
    if (x < y) return -dir
    if (x > y) return dir
    return a.id < b.id ? -1 : 1
  })
}

export function PaymentTable({
  payments,
  onEdit,
  onDelete,
  onStatus,
  showTotals = true,
  defaultSort = 'work',
  compact,
  estimatedIds,
}: {
  payments: Payment[]
  onEdit?: (p: Payment) => void
  onDelete?: (p: Payment) => void
  onStatus?: (p: Payment, s: PaymentStatus) => void
  showTotals?: boolean
  defaultSort?: SortKey
  compact?: boolean
  estimatedIds?: Set<string>
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: defaultSort, dir: -1 })
  if (!payments.length) return <Empty>No payments match these filters.</Empty>
  const rows = sortPayments(payments, sort.key, sort.dir)
  const t = lifetimeTotals(payments)

  const H = ({ k, children, className }: { k: SortKey; children: string; className?: string }) => (
    <Th className={className} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button
        className="inline-flex items-center gap-0.5 uppercase"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : -1 }))}
      >
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </Th>
  )

  const statusControl = (p: Payment) =>
    onStatus ? (
      <label className="relative inline-flex cursor-pointer" title="Change status">
        <StatusBadge status={p.status} label={p.statusLabel} />
        <select aria-label="Payment status" className="absolute inset-0 cursor-pointer opacity-0" value={p.status} onChange={(e) => onStatus(p, e.target.value as PaymentStatus)}>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
    ) : (
      <StatusBadge status={p.status} label={p.statusLabel} />
    )

  const mobile = (
    <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white xl:hidden">
      {rows.map((p) => (
        <div key={p.id} className="flex items-start gap-2 px-3 py-2" onClick={() => onEdit?.(p)}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{p.contract}</span>
              <TypeBadge type={p.type} />
            </div>
            <div className="text-xs text-ink-soft">
              {formatRange(p.workStart, p.workEnd)}
              {estimatedIds?.has(p.id) && ' \u00b7 est.'}
              {p.hours !== null && ` \u00b7 ${p.hours.toFixed(2)} h`}
              {p.payoutDate && ` \u00b7 payout ${formatDate(p.payoutDate, false)}`}
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5" onClick={(e) => e.stopPropagation()}>
            <span className="num text-sm font-semibold">{formatCents(p.earningsCents)}</span>
            {statusControl(p)}
          </div>
        </div>
      ))}
      {showTotals && (
        <div className="flex items-center justify-between bg-total/60 px-3 py-2 text-sm font-semibold">
          <span>Total · {t.count} · {t.hours.toFixed(2)} h</span>
          <span className="num">{formatCents(t.totalCents)}</span>
        </div>
      )}
      {showTotals && (
        <div className="flex gap-2 px-3 py-1.5 text-xs font-medium">
          <span className="rounded bg-paid px-1.5 py-0.5 text-paid-ink">Paid {formatCents(t.paidCents)}</span>
          <span className="rounded bg-pending px-1.5 py-0.5 text-pending-ink">Pending {formatCents(t.pendingCents)}</span>
        </div>
      )}
    </div>
  )

  return (
    <>
    {mobile}
    <Table className="hidden xl:block">
      <thead>
        <tr>
          <H k="work">Work period</H>
          <H k="contract">Contract</H>
          <Th>Type</Th>
          <H k="hours">Hours</H>
          {!compact && <Th className="hidden xl:table-cell">Rate</Th>}
          <H k="earnings">Earnings</H>
          <H k="status">Status</H>
          <H k="payout" className={compact ? 'hidden md:table-cell' : ''}>Payout</H>
          {!compact && <Th className="hidden 2xl:table-cell">Release</Th>}
          {(onEdit || onDelete) && <Th className="w-0"><span className="sr-only">Actions</span></Th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className="hover:bg-support/40">
            <Td className="whitespace-nowrap">
              {formatRange(p.workStart, p.workEnd)}
              {estimatedIds?.has(p.id) && (
                <span title="Work period crosses this period's boundary; amount is split by days (estimated)" className="ml-1 cursor-help rounded bg-support px-1 text-[10px] text-ink-soft">est.</span>
              )}
            </Td>
            <Td className="max-w-[14rem] truncate font-medium" title={p.notes ? `${p.contract} — ${p.notes}` : p.contract}>{p.contract}</Td>
            <Td><TypeBadge type={p.type} /></Td>
            <Td className="num whitespace-nowrap">{p.hours === null ? '—' : p.hours.toFixed(2)}</Td>
            {!compact && (
              <Td className="num hidden whitespace-nowrap text-ink-soft xl:table-cell" title={p.rateInferred ? 'Inferred from earnings ÷ rounded hours' : undefined}>
                {p.rateCents ? `${formatCents(p.rateCents)}${p.rateInferred ? '*' : ''}` : '—'}
              </Td>
            )}
            <Td className="num whitespace-nowrap font-semibold">{formatCents(p.earningsCents)}</Td>
            <Td>
              {statusControl(p)}
            </Td>
            <Td className={cn('whitespace-nowrap text-ink-soft', compact && 'hidden md:table-cell')}>{formatDate(p.payoutDate)}</Td>
            {!compact && (
              <Td className="hidden whitespace-nowrap text-ink-soft 2xl:table-cell">
                {p.releaseDate ? `${formatDate(p.releaseDate)}${p.releaseKind === 'expected' ? ' (exp.)' : ''}` : '—'}
              </Td>
            )}
            {(onEdit || onDelete) && (
              <Td className="whitespace-nowrap py-0.5 text-right">
                <ActionsMenu
                  label={`Actions for ${p.contract}`}
                  items={[
                    ...(onEdit ? [{ label: 'View and edit', onSelect: () => onEdit(p), icon: <Pencil className="size-4" /> }] : []),
                    ...(onDelete ? [{ label: 'Delete payment', onSelect: () => onDelete(p), danger: true, icon: <Trash2 className="size-4" /> }] : []),
                  ]}
                />
              </Td>
            )}
          </tr>
        ))}
      </tbody>
      {showTotals && (
        <tfoot>
          <tr className="bg-total/60 font-semibold">
            <Td>Total · {t.count} payment{t.count === 1 ? '' : 's'}</Td>
            <Td />
            <Td />
            <Td className="num">{t.hours.toFixed(2)}</Td>
            {!compact && <Td className="hidden xl:table-cell" />}
            <Td className="num whitespace-nowrap">{formatCents(t.totalCents)}</Td>
            <Td colSpan={2 + (compact ? 0 : 1) + (onEdit || onDelete ? 1 : 0)} className="text-xs font-medium">
              <span className="mr-2 rounded bg-paid px-1.5 py-0.5 text-paid-ink">Paid {formatCents(t.paidCents)}</span>
              <span className="rounded bg-pending px-1.5 py-0.5 text-pending-ink">Pending {formatCents(t.pendingCents)}</span>
            </Td>
          </tr>
        </tfoot>
      )}
    </Table>
    </>
  )
}
