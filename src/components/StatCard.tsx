import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

const tones = {
  total: 'bg-total',
  hourly: 'bg-hourly',
  paid: 'bg-paid',
  pending: 'bg-pending',
  incentive: 'bg-incentive',
  support: 'bg-support',
  title: 'bg-title',
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'support',
  hint,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: keyof typeof tones
  hint?: string
  className?: string
}) {
  return (
    <div className={cn('rounded-xl px-3.5 py-3', tones[tone], className)}>
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink/70">
        {label}
        {hint && (
          <span title={hint} className="cursor-help text-ink/50">
            <Info className="size-3" />
          </span>
        )}
      </div>
      <div className="num mt-0.5 text-xl font-semibold leading-7 text-ink">{value}</div>
      {sub && <div className="num text-xs text-ink/70">{sub}</div>}
    </div>
  )
}
