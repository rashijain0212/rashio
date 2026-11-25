import { useMemo, useState } from 'react'
import { Download, Plus, Search } from 'lucide-react'
import { useData } from '@/hooks/data'
import { usePaymentActions } from '@/hooks/actions'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { PaymentTable } from '@/components/PaymentTable'
import { PaymentDialog } from '@/components/PaymentDialog'
import { STATUS_LABEL, TYPE_LABEL } from '@/components/labels'
import { workInterval } from '@/lib/calc'
import { toCsv, downloadFile } from '@/lib/export'
import type { Payment } from '@/lib/types'

export default function Payments() {
  const { payments } = useData()
  const actions = usePaymentActions()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [workFrom, setWorkFrom] = useState('')
  const [workTo, setWorkTo] = useState('')
  const [payFrom, setPayFrom] = useState('')
  const [payTo, setPayTo] = useState('')
  const [editing, setEditing] = useState<Payment | null>(null)
  const [adding, setAdding] = useState(false)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return payments.filter((p) => {
      if (status && p.status !== status) return false
      if (type && p.type !== type) return false
      const iv = workInterval(p)
      if (workFrom && (!iv || iv[1] < workFrom)) return false
      if (workTo && (!iv || iv[0] > workTo)) return false
      if (payFrom && (!p.payoutDate || p.payoutDate < payFrom)) return false
      if (payTo && (!p.payoutDate || p.payoutDate > payTo)) return false
      if (needle) {
        const hay = `${p.contract} ${p.notes ?? ''} ${TYPE_LABEL[p.type]} ${STATUS_LABEL[p.status]} ${(p.earningsCents / 100).toFixed(2)} ${p.payoutDate ?? ''} ${p.workStart ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [payments, q, status, type, workFrom, workTo, payFrom, payTo])
  const contracts = [...new Set(payments.map((p) => p.contract))].sort()
  const anyFilter = q || status || type || workFrom || workTo || payFrom || payTo

  return (
    <>
      <PageHeader
        title="All payments"
        subtitle={`${payments.length} records · click a status to change it`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => downloadFile('chaching-payments.csv', toCsv(rows), 'text/csv')}><Download /> Export CSV</Button>
            <Button size="sm" variant="accent" onClick={() => setAdding(true)}><Plus /> Add payment</Button>
          </>
        }
      />
      <Card className="mb-3">
        <CardContent className="grid grid-cols-2 gap-2 pt-3 md:grid-cols-4 lg:grid-cols-8">
          <div className="relative col-span-2">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-faint" />
            <Input aria-label="Search" placeholder="Search contract, notes, amount…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label className="text-[11px] text-ink-soft">Work from<Input type="date" value={workFrom} onChange={(e) => setWorkFrom(e.target.value)} /></label>
          <label className="text-[11px] text-ink-soft">Work to<Input type="date" value={workTo} onChange={(e) => setWorkTo(e.target.value)} /></label>
          <label className="text-[11px] text-ink-soft">Payout from<Input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} /></label>
          <label className="text-[11px] text-ink-soft">Payout to<Input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)} /></label>
          {anyFilter && (
            <button className="col-span-2 justify-self-start text-xs text-accent hover:underline md:col-span-4 lg:col-span-8" onClick={() => { setQ(''); setStatus(''); setType(''); setWorkFrom(''); setWorkTo(''); setPayFrom(''); setPayTo('') }}>
              Clear filters · {rows.length} of {payments.length} shown
            </button>
          )}
        </CardContent>
      </Card>
      <PaymentTable payments={rows} onEdit={setEditing} onDelete={actions.remove} onStatus={actions.setStatus} />
      <PaymentDialog open={adding || !!editing} initial={editing} onClose={() => { setEditing(null); setAdding(false) }} onSave={actions.save} contracts={contracts} />
    </>
  )
}
