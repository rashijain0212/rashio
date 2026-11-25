import { useState } from 'react'
import { ClipboardPaste, RotateCcw, Undo2 } from 'lucide-react'
import { friendlyError, useData } from '@/hooks/data'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/Table'
import { firestoreDb } from '@/lib/firebase'
import { EditedSinceImportError, undoImport } from '@/lib/store'
import { formatCents } from '@/lib/money'
import type { ImportRecord } from '@/lib/types'
import { cn } from '@/lib/utils'

const signed = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatCents(Math.abs(c))}`
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

type Entry = { at: number; kind: 'import' | 'undo'; rec: ImportRecord }

function summary(r: ImportRecord): string {
  const parts: string[] = []
  if (r.counts.created) parts.push(`${r.counts.created} new payment${r.counts.created === 1 ? '' : 's'}`)
  if (r.counts.updated) parts.push(`${r.counts.updated} payment${r.counts.updated === 1 ? '' : 's'} updated`)
  if (!parts.length) parts.push('no payment changes')
  const d = r.totalAfterCents !== undefined && r.totalBeforeCents !== undefined ? r.totalAfterCents - r.totalBeforeCents : null
  return `${parts.join(' · ')}${d ? ` · ${signed(d)} earnings` : ''}`
}

export default function Activity() {
  const { uid, imports } = useData()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const latestKept = imports.find((i) => !i.undone)

  const entries: Entry[] = [
    ...imports.map((rec) => ({ at: rec.createdAt, kind: 'import' as const, rec })),
    ...imports.filter((r) => r.undone && r.undoneAt).map((rec) => ({ at: rec.undoneAt!, kind: 'undo' as const, rec })),
  ].sort((a, b) => b.at - a.at)
  const groups = new Map<string, Entry[]>()
  for (const e of entries) groups.set(day(e.at), [...(groups.get(day(e.at)) ?? []), e])

  const undo = async (rec: ImportRecord) => {
    const parts: string[] = []
    if (rec.counts.created) parts.push(`${rec.counts.created} payment${rec.counts.created === 1 ? '' : 's'} it added will be deleted`)
    if (rec.counts.updated) parts.push(`${rec.counts.updated} payment${rec.counts.updated === 1 ? '' : 's'} it updated will go back to their earlier values`)
    const delta = rec.totalAfterCents !== undefined && rec.totalBeforeCents !== undefined ? rec.totalBeforeCents - rec.totalAfterCents : null
    const text = [
      `Undo the import from ${new Date(rec.createdAt).toLocaleString()}?`,
      '',
      ...parts.map((p) => `• ${p}`),
      ...(delta !== null ? [`• Your tracked total changes by ${signed(delta)}`] : []),
      '• The dashboard figures saved by that import are restored to their earlier values',
      '',
      'Only do this if that import was wrong. To bring payments up to date, just paste the dashboard again — no undo needed.',
    ].join('\n')
    if (!window.confirm(text)) return
    setMsg(null)
    try {
      const r = await undoImport(firestoreDb, uid, rec.id)
      setMsg({ ok: true, text: `Import undone: ${r.deleted} removed, ${r.restored} restored. Your earnings and spreadsheet are back to how they were.` })
    } catch (e) {
      if (e instanceof EditedSinceImportError && window.confirm(`${e.message}`)) {
        const r = await undoImport(firestoreDb, uid, rec.id, true)
        setMsg({ ok: true, text: `Import undone: ${r.deleted} removed, ${r.restored} restored.` })
      } else if (!(e instanceof EditedSinceImportError)) setMsg({ ok: false, text: `Undo didn't happen — nothing was changed. ${friendlyError(e)}` })
    }
  }

  return (
    <>
      <PageHeader title="Activity" subtitle="Every import, newest first. Undo is available for the latest import." />
      {msg && <div className={cn('mb-3 rounded-xl px-4 py-3 text-sm', msg.ok ? 'bg-paid text-paid-ink' : 'bg-danger/10 text-danger')} role="status">{msg.text}</div>}
      {!entries.length ? (
        <Empty>No activity yet. Your imports will appear here.</Empty>
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([d, list]) => (
            <section key={d}>
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">{d}</h2>
              <Card>
                <CardContent className="divide-y divide-line px-0 pb-0">
                  {list.map((e) => {
                    const r = e.rec
                    const canUndo = e.kind === 'import' && !r.undone && r.id === latestKept?.id && (r.counts.created || r.counts.updated)
                    return (
                      <div key={`${e.kind}-${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', e.kind === 'undo' ? 'bg-pending/70' : 'bg-brand')}>
                          {e.kind === 'undo' ? <Undo2 className="size-4 text-pending-ink" /> : <ClipboardPaste className="size-4 text-brand-ink" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className={cn('text-sm font-medium text-ink', e.kind === 'import' && r.undone && 'text-ink-faint line-through')}>
                            {e.kind === 'undo' ? 'Import undone' : 'Imported earnings'}
                          </div>
                          <div className="text-xs text-ink-soft">
                            {time(e.at)} · {e.kind === 'undo' ? `reverted the ${time(r.createdAt)} import (${summary(r)})` : summary(r)}
                          </div>
                        </div>
                        {canUndo ? (
                          <Button variant="outline" size="sm" onClick={() => undo(r)}><RotateCcw /> Undo</Button>
                        ) : e.kind === 'import' && r.undone ? (
                          <span className="text-xs text-ink-faint">Undone</span>
                        ) : null}
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
