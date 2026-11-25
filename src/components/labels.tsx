import { Badge } from '@/components/ui/badge'
import type { PaymentStatus, PaymentType } from '@/lib/types'

export const TYPE_LABEL: Record<PaymentType, string> = {
  hourly: 'Hourly',
  incentive: 'Incentive',
  work_trial: 'Work trial',
  other: 'Other',
}

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: 'Paid',
  pending: 'Pending',
  processing: 'Processing',
  failed: 'Failed',
  other: 'Unknown',
}

export function StatusBadge({ status, label }: { status: PaymentStatus; label?: string }) {
  const tone = status === 'paid' ? 'paid' : status === 'failed' ? 'danger' : status === 'other' ? 'neutral' : 'pending'
  const text = label && label.toLowerCase() !== STATUS_LABEL[status].toLowerCase() ? label : STATUS_LABEL[status]
  return (
    <Badge tone={tone}>
      <span aria-hidden className="text-[9px]">{status === 'paid' ? '●' : status === 'failed' ? '✕' : '◐'}</span>
      {text}
    </Badge>
  )
}

export function TypeBadge({ type }: { type: PaymentType }) {
  const tone = type === 'hourly' ? 'hourly' : type === 'incentive' ? 'incentive' : type === 'work_trial' ? 'title' : 'neutral'
  return <Badge tone={tone}>{TYPE_LABEL[type]}</Badge>
}

/** Chart colors: validated categorical palette (light surface) + reserved status pair. */
export const CHART = {
  hourly: '#3B6FD4',
  incentive: '#C44E8F',
  trial: '#C77A1E',
  other: '#6E6EC0',
  paid: '#3FA05A',
  pending: '#E5A23B',
  total: '#3B6FD4',
  grid: '#EEF0F4',
  axis: '#98A2B3',
}
