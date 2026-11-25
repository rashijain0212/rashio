import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { formatCents, formatCentsCompact } from '@/lib/money'
import { CHART } from './labels'

export interface Series {
  key: string
  name: string
  color: string
}

function MoneyTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((a, p) => a + (Number(p.value) || 0), 0)
  return (
    <div className="rounded-lg border border-line bg-white px-2.5 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-ink">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-soft">
            <span className="inline-block size-2 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="num font-medium text-ink">{formatCents(Number(p.value))}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold text-ink">
          <span>Total</span>
          <span className="num">{formatCents(total)}</span>
        </div>
      )}
    </div>
  )
}

const axisProps = {
  tick: { fill: CHART.axis, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: CHART.grid },
}

export function StackedBars({ data, series, height = 240, xKey = 'label' }: { data: Record<string, unknown>[]; series: Series[]; height?: number; xKey?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} axisLine={false} width={52} tickFormatter={(v) => formatCentsCompact(v)} />
        <Tooltip content={(p) => <MoneyTooltip {...(p as TooltipContentProps<number, string>)} />} cursor={{ fill: '#EDEFF3', opacity: 0.6 }} />
        <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11, color: '#667085' }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="a"
            fill={s.color}
            stroke="#fff"
            strokeWidth={1}
            maxBarSize={44}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function GroupedBars({ data, series, height = 240, xKey = 'label', layout = 'horizontal' }: { data: Record<string, unknown>[]; series: Series[]; height?: number; xKey?: string; layout?: 'horizontal' | 'vertical' }) {
  const vertical = layout === 'vertical'
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={vertical} horizontal={!vertical} stroke={CHART.grid} />
        {vertical ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={(v) => formatCentsCompact(v)} />
            <YAxis type="category" dataKey={xKey} {...axisProps} width={120} axisLine={false} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} axisLine={false} width={52} tickFormatter={(v) => formatCentsCompact(v)} />
          </>
        )}
        <Tooltip content={(p) => <MoneyTooltip {...(p as TooltipContentProps<number, string>)} />} cursor={{ fill: '#EDEFF3', opacity: 0.6 }} />
        {series.length > 1 && <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11, color: '#667085' }} />}
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} maxBarSize={vertical ? 18 : 36} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TrendLine({ data, series, height = 240, xKey = 'label' }: { data: Record<string, unknown>[]; series: Series[]; height?: number; xKey?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} axisLine={false} width={52} tickFormatter={(v) => formatCentsCompact(v)} />
        <Tooltip content={(p) => <MoneyTooltip {...(p as TooltipContentProps<number, string>)} />} cursor={{ stroke: CHART.axis, strokeDasharray: '3 3' }} />
        {series.length > 1 && <Legend iconType="plainline" iconSize={12} wrapperStyle={{ fontSize: 11, color: '#667085' }} />}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export const TYPE_SERIES: Series[] = [
  { key: 'hourly', name: 'Hourly', color: CHART.hourly },
  { key: 'incentive', name: 'Incentives', color: CHART.incentive },
  { key: 'trial', name: 'Work trials', color: CHART.trial },
  { key: 'other', name: 'Other', color: CHART.other },
]

export const STATUS_SERIES: Series[] = [
  { key: 'paid', name: 'Paid', color: CHART.paid },
  { key: 'pending', name: 'Pending', color: CHART.pending },
]

/** Drop series that are all-zero so legends stay meaningful. */
export function activeSeries(series: Series[], data: Record<string, unknown>[]): Series[] {
  return series.filter((s) => data.some((d) => Number(d[s.key]) !== 0))
}
