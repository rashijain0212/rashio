import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-title px-4 py-3">
      <div>
        <h1 className="text-lg font-semibold leading-6 text-ink">{title}</h1>
        {subtitle && <p className="text-xs text-ink/70">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
