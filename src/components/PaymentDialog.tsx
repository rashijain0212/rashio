import { useEffect, useState } from 'react'
import { Dialog } from './ui/dialog'
import { Button } from './ui/button'
import { Input, Label, Select, Textarea } from './ui/input'
import type { MonthAllocation, Payment, PaymentStatus, PaymentType } from '@/lib/types'
import { parseMoneyToCents, formatCents } from '@/lib/money'
import { monthKey, monthRange } from '@/lib/dates'
import { STATUS_LABEL, TYPE_LABEL } from './labels'

export type PaymentDraft = Omit<Payment, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: number }

const blank: PaymentDraft = {
  contract: '',
  type: 'hourly',
  workStart: null,
  workEnd: null,
  payoutDate: null,
  hours: null,
  earningsCents: 0,
  rateCents: null,
  status: 'pending',
  releaseDate: null,
  releaseKind: null,
  notes: '',
  source: 'manual',
}

export function PaymentDialog({
  open,
  initial,
  onClose,
  onSave,
  contracts,
}: {
  open: boolean
  initial: Payment | null
  onClose: () => void
  onSave: (p: PaymentDraft) => Promise<void>
  contracts: string[]
}) {
  const [d, setD] = useState<PaymentDraft>(blank)
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const src = initial ?? blank
    setD({ ...src })
    setAmount(initial ? (initial.earningsCents / 100).toFixed(2) : '')
    setRate(initial?.rateCents ? (initial.rateCents / 100).toFixed(2) : '')
    setAlloc(Object.fromEntries((initial?.allocation ?? []).map((a) => [a.month, (a.cents / 100).toFixed(2)])))
    setErr(null)
  }, [open, initial])

  const set = <K extends keyof PaymentDraft>(k: K, v: PaymentDraft[K]) => setD((x) => ({ ...x, [k]: v }))
  const crossMonths =
    d.workStart && d.workEnd && monthKey(d.workStart) !== monthKey(d.workEnd)
      ? monthRange(monthKey(d.workStart), monthKey(d.workEnd))
      : []

  const save = async () => {
    const cents = parseMoneyToCents(amount.startsWith('$') || amount.startsWith('-') ? amount : `$${amount}`)
    if (!d.contract.trim()) return setErr('Contract name is required.')
    if (cents === null) return setErr('Enter a valid earnings amount, e.g. 1275.10')
    if (d.workStart && d.workEnd && d.workEnd < d.workStart) return setErr('Work period end is before start.')
    let rateCents: number | null = null
    if (d.type === 'hourly' && rate.trim()) {
      rateCents = parseMoneyToCents(`$${rate.replace('$', '')}`)
      if (rateCents === null) return setErr('Invalid hourly rate.')
    }
    let allocation: MonthAllocation[] | null = null
    const filled = crossMonths.filter((m) => alloc[m]?.trim())
    if (filled.length) {
      allocation = crossMonths.map((m) => ({ month: m, cents: parseMoneyToCents(`$${(alloc[m] || '0').replace('$', '')}`) ?? 0 }))
      const sum = allocation.reduce((a, x) => a + x.cents, 0)
      if (sum !== cents) return setErr(`Month split adds up to ${formatCents(sum)}, but earnings are ${formatCents(cents)}.`)
    }
    setBusy(true)
    try {
      await onSave({
        ...d,
        contract: d.contract.trim(),
        earningsCents: cents,
        rateCents,
        rateInferred: false,
        allocation: crossMonths.length ? allocation : null,
        statusLabel: d.status === initial?.status ? d.statusLabel : STATUS_LABEL[d.status],
      })
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? 'Edit payment' : 'Add payment'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="pd-contract">Contract</Label>
          <Input id="pd-contract" list="pd-contracts" value={d.contract} onChange={(e) => set('contract', e.target.value)} />
          <datalist id="pd-contracts">{contracts.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <Label htmlFor="pd-type">Payment type</Label>
          <Select id="pd-type" value={d.type} onChange={(e) => set('type', e.target.value as PaymentType)}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="pd-status">Status</Label>
          <Select id="pd-status" value={d.status} onChange={(e) => set('status', e.target.value as PaymentStatus)}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="pd-ws">Work start</Label>
          <Input id="pd-ws" type="date" value={d.workStart ?? ''} onChange={(e) => set('workStart', e.target.value || null)} />
        </div>
        <div>
          <Label htmlFor="pd-we">Work end</Label>
          <Input id="pd-we" type="date" value={d.workEnd ?? ''} onChange={(e) => set('workEnd', e.target.value || null)} />
        </div>
        <div>
          <Label htmlFor="pd-amt">Earnings (USD)</Label>
          <Input id="pd-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label htmlFor="pd-hours">Hours</Label>
          <Input id="pd-hours" inputMode="decimal" value={d.hours ?? ''} onChange={(e) => set('hours', e.target.value === '' ? null : Number(e.target.value))} disabled={d.type !== 'hourly'} />
        </div>
        <div>
          <Label htmlFor="pd-rate">Hourly rate</Label>
          <Input id="pd-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={d.type === 'hourly' ? 'auto' : 'n/a'} disabled={d.type !== 'hourly'} />
        </div>
        <div>
          <Label htmlFor="pd-payout">Payout date</Label>
          <Input id="pd-payout" type="date" value={d.payoutDate ?? ''} onChange={(e) => set('payoutDate', e.target.value || null)} />
        </div>
        <div>
          <Label htmlFor="pd-release">Release date</Label>
          <Input id="pd-release" type="date" value={d.releaseDate ?? ''} onChange={(e) => set('releaseDate', e.target.value || null)} />
        </div>
        <div>
          <Label htmlFor="pd-rk">Release is</Label>
          <Select id="pd-rk" value={d.releaseKind ?? ''} onChange={(e) => set('releaseKind', (e.target.value || null) as Payment['releaseKind'])}>
            <option value="">—</option>
            <option value="actual">Actual</option>
            <option value="expected">Expected</option>
          </Select>
        </div>
        {crossMonths.length > 0 && (
          <div className="col-span-2 rounded-lg bg-support p-2.5">
            <div className="mb-1.5 text-xs font-medium">Split across months (optional)</div>
            <p className="mb-2 text-[11px] text-ink-soft">This period crosses months. Leave blank to estimate by days, or enter exact amounts from your statement.</p>
            <div className="grid grid-cols-2 gap-2">
              {crossMonths.map((m) => (
                <div key={m}>
                  <Label htmlFor={`pd-alloc-${m}`}>{m}</Label>
                  <Input id={`pd-alloc-${m}`} inputMode="decimal" value={alloc[m] ?? ''} onChange={(e) => setAlloc((a) => ({ ...a, [m]: e.target.value }))} placeholder="estimate" />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="col-span-2">
          <Label htmlFor="pd-notes">Notes</Label>
          <Textarea id="pd-notes" rows={2} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {err && <p className="col-span-2 text-sm text-danger">{err}</p>}
      </div>
    </Dialog>
  )
}
