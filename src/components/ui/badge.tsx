import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap', {
  variants: {
    tone: {
      paid: 'bg-paid text-paid-ink',
      pending: 'bg-pending text-pending-ink',
      incentive: 'bg-incentive text-incentive-ink',
      hourly: 'bg-hourly text-[#2B5AA8]',
      total: 'bg-total text-[#2B5AA8]',
      neutral: 'bg-support text-ink-soft',
      title: 'bg-title text-ink',
      danger: 'bg-danger/10 text-danger',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
