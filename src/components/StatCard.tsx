import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

// The original purposeful pastel fills, with dark text on top; the dot repeats the
// meaning in shape so colour is never the only cue.
const fills = {
  total: 'bg-total',
  hourly: 'bg-hourly',
  paid: 'bg-paid',
  pending: 'bg-pending',
  incentive: 'bg-incentive',
  support: 'bg-support',
  title: 'bg-title',
}
const markers = {
  total: 'bg-[#4F7CC4]',
  hourly: 'bg-[#6E95D6]',
  paid: 'bg-paid-ink',
  pending: 'bg-pending-ink',
  incentive: 'bg-incentive-ink',
  support: 'bg-ink-soft',
  title: 'bg-accent',
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'support',
  hint,
  className,
  emphasis,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: keyof typeof markers
  hint?: string
  className?: string
  /** a larger value, used for the one figure that matters most */
  emphasis?: boolean
}) {
  return (
    <div className={cn('min-w-0 rounded-xl px-3.5 py-3', fills[tone], className)}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink/80">
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', markers[tone])} />
        {label}
        {hint && (
          <span title={hint} className="cursor-help text-ink/60">
            <Info className="size-3" />
            <span className="sr-only">{hint}</span>
          </span>
        )}
      </div>
      <div className={cn('num mt-1 font-semibold text-ink', emphasis ? 'text-2xl leading-8' : 'text-xl leading-7')}>{value}</div>
      {sub && <div className="num text-xs text-ink/80">{sub}</div>}
    </div>
  )
}
