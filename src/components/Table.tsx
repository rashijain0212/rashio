import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative overflow-x-auto rounded-lg border border-line', className)}>
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  )
}

export function Th({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('bg-thead px-2 py-1.5 text-left sm:px-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink/80 whitespace-nowrap', className)} {...p} />
}

export function Td({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-t border-line px-2 py-1.5 align-middle sm:px-2.5', className)} {...p} />
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line bg-support/50 px-4 py-6 text-center text-sm text-ink-soft">{children}</div>
}
