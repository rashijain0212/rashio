import { useCallback } from 'react'
import { useData } from './data'
import { firestoreDb } from '@/lib/firebase'
import { deletePayments, savePayment } from '@/lib/store'
import type { Payment, PaymentStatus } from '@/lib/types'
import type { PaymentDraft } from '@/components/PaymentDialog'
import { STATUS_LABEL } from '@/components/labels'

export function usePaymentActions() {
  const { uid, payments } = useData()
  const byId = useCallback((id: string) => payments.find((p) => p.id === id), [payments])

  const save = useCallback(async (d: PaymentDraft) => {
    await savePayment(firestoreDb, uid, d)
  }, [uid])

  const setStatus = useCallback(
    async (p: Payment, status: PaymentStatus) => {
      const orig = byId(p.id) ?? p
      await savePayment(firestoreDb, uid, {
        ...orig,
        status,
        statusLabel: STATUS_LABEL[status],
        releaseKind: status === 'paid' && orig.releaseDate ? 'actual' : orig.releaseKind ?? null,
      })
    },
    [uid, byId],
  )

  const remove = useCallback(
    async (p: Payment) => {
      if (!window.confirm(`Delete this payment?\n\n${p.contract} · $${(p.earningsCents / 100).toFixed(2)}\n\nThis cannot be undone (a later import may recreate it if it is still on the earnings page).`)) return
      await deletePayments(firestoreDb, uid, [p.id])
    },
    [uid],
  )

  return { save, setStatus, remove, byId }
}
