import { useState } from 'react'
import { CheckCircle2, ExternalLink, FilePlus2, FolderOpen, RefreshCw, Sheet, Unlink } from 'lucide-react'
import { useData } from '@/hooks/data'
import { markSheetSynced, useSheetsSync } from '@/hooks/sheets'
import { buildSheetModel, syncSpreadsheet } from '@/lib/sheets'
import { connectGoogleSheets, createSpreadsheet, pickSpreadsheet, sheetsApi, SheetsAuthError } from '@/lib/sheetsClient'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ActionsMenu } from '@/components/ui/menu'
import { timeAgo } from '@/components/CloudStatus'
import { firestoreDb } from '@/lib/firebase'
import { saveSettings } from '@/lib/store'
import { lifetimeTotals } from '@/lib/calc'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'

const WRITES = [
  ['Monthly tabs', 'One tab per work month; rows added or removed inside the table so your formatting stays'],
  ['New months', 'Copied from your latest month tab, so formulas, colours and charts carry over'],
  ['Overview', 'Monthly totals, 21st-to-21st cycles and project earnings'],
  ['Earnings data', 'A full list of every payment, rewritten on each update'],
] as const

export default function Spreadsheets() {
  const { uid, settings, payments, meta } = useData()
  const sheets = useSheetsSync()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; title: string; text?: string } | null>(null)
  const id = settings.sheetsSpreadsheetId
  const connected = !!id && settings.sheetsFileAccess === true
  const needsChoose = !!id && !connected
  const url = id ? `https://docs.google.com/spreadsheets/d/${id}` : null
  const tracked = lifetimeTotals(payments)

  const save = (patch: Partial<typeof settings>) => saveSettings(firestoreDb, uid, { ...settings, ...patch })

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setNote(null)
    try {
      await fn()
    } catch (e) {
      const msg = (e as Error).message
      setNote(
        e instanceof SheetsAuthError || /popup|cancel/i.test(msg)
          ? { ok: false, title: 'Google access is needed to update your spreadsheet.', text: 'Your earnings are already saved. Try again and allow access in the Google window.' }
          : { ok: false, title: 'Spreadsheet not updated.', text: `Your earnings are safe in ChaChing. ${msg}` },
      )
    } finally {
      setBusy(false)
    }
  }

  const syncWithId = async (sheetId: string, extra: Partial<typeof settings> = {}) => {
    const model = buildSheetModel(payments, meta.projects, settings.cycleStartDay)
    const res = await syncSpreadsheet(sheetsApi(sheetId), model)
    markSheetSynced(meta.revision)
    await save({ ...extra, sheetsSpreadsheetId: sheetId, sheetsLastSyncAt: Date.now(), sheetsLastError: null })
    return res
  }

  const choose = () =>
    run(async () => {
      await connectGoogleSheets() // Google window must open inside the click
      const picked = await pickSpreadsheet()
      if (!picked) return setNote({ ok: false, title: 'No spreadsheet chosen.' })
      const extra = { sheetsSpreadsheetName: picked.name, sheetsFileAccess: true, sheetsAutoSync: settings.sheetsAutoSync ?? true }
      await save({ ...extra, sheetsSpreadsheetId: picked.id })
      const res = await syncWithId(picked.id, extra)
      setNote({ ok: true, title: `“${picked.name}” is connected and up to date.`, text: `${res.monthsWritten.length} month tabs updated${res.createdTabs.length ? `; added ${res.createdTabs.join(', ')}` : ''}.` })
    })

  const syncNow = () =>
    run(async () => {
      if (!sheets.connected) await connectGoogleSheets()
      const res = await syncWithId(id!)
      setNote({ ok: true, title: 'Spreadsheet is up to date.', text: `${res.monthsWritten.length} month tabs updated.` })
    })

  const createNew = () =>
    run(async () => {
      await connectGoogleSheets()
      const newId = await createSpreadsheet('ChaChing earnings')
      const extra = { sheetsSpreadsheetName: 'ChaChing earnings', sheetsFileAccess: true, sheetsAutoSync: true }
      await save({ ...extra, sheetsSpreadsheetId: newId })
      await syncWithId(newId, extra)
      setNote({ ok: true, title: 'Created “ChaChing earnings” in your Google Drive and filled it in.' })
    })

  const disconnect = () =>
    run(async () => {
      if (!window.confirm('Disconnect the spreadsheet? ChaChing stops updating it. The spreadsheet itself and your earnings are not changed.')) return
      await save({ sheetsSpreadsheetId: null, sheetsSpreadsheetName: null, sheetsFileAccess: false, sheetsLastError: null })
      setNote({ ok: true, title: 'Spreadsheet disconnected.' })
    })

  // The report is behind when the cloud data changed after the last confirmed sheet update.
  const latestChange = Math.max(meta.lastSyncAt ?? 0, meta.lastSummaryAt ?? 0)
  const behind = connected && !!settings.sheetsLastSyncAt && latestChange > settings.sheetsLastSyncAt + 60_000
  const status = !connected
    ? { label: needsChoose ? 'Choose once to finish setup' : 'Not connected', tone: 'bg-support text-ink-soft' }
    : settings.sheetsLastError
      ? { label: 'Needs attention', tone: 'bg-pending text-pending-ink' }
      : behind
        ? { label: 'Waiting to update', tone: 'bg-pending text-pending-ink' }
        : { label: 'Up to date', tone: 'bg-paid text-paid-ink' }

  return (
    <>
      <PageHeader title="Spreadsheets" subtitle="Keep your Google Sheet in step with your saved earnings, automatically." />

      {note && (
        <div className={cn('mb-3 rounded-xl px-4 py-3 text-sm', note.ok ? 'bg-paid text-paid-ink' : 'bg-pending/70 text-pending-ink')} role="status">
          <div className="font-semibold">{note.title}</div>
          {note.text && <div>{note.text}</div>}
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-paid/60"><Sheet className="size-5 text-paid-ink" /></div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-ink">{connected ? settings.sheetsSpreadsheetName || 'Your spreadsheet' : 'No spreadsheet connected'}</div>
              <div className="text-xs text-ink-soft">{connected ? 'Connected Google spreadsheet' : 'Connect a spreadsheet to keep a report updated after every change.'}</div>
            </div>
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', status.tone)}>
              {status.label === 'Up to date' && <CheckCircle2 className="mr-1 inline size-3.5" />}
              {status.label}
            </span>
            {connected && (
              <ActionsMenu
                label="More spreadsheet actions"
                items={[
                  { label: 'Choose a different spreadsheet', onSelect: choose, icon: <FolderOpen className="size-4" /> },
                  { label: 'Create a new spreadsheet', onSelect: createNew, icon: <FilePlus2 className="size-4" /> },
                  { label: 'Disconnect', onSelect: disconnect, danger: true, icon: <Unlink className="size-4" /> },
                ]}
              />
            )}
          </div>

          {needsChoose && (
            <p className="mt-3 rounded-lg bg-brand-soft px-3 py-2 text-sm text-ink">
              One-time step: ChaChing now asks only for access to the spreadsheet you choose. Click <b>Choose spreadsheet</b> and select{' '}
              {url ? <a className="underline" href={url} target="_blank" rel="noreferrer">your earnings sheet</a> : 'your earnings sheet'}.
            </p>
          )}

          {connected && (
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-4">
              <div><dt className="text-[11px] text-ink-soft">Last updated</dt><dd className="font-semibold">{settings.sheetsLastSyncAt ? timeAgo(settings.sheetsLastSyncAt) : 'Not yet'}</dd></div>
              <div><dt className="text-[11px] text-ink-soft">Saved payments</dt><dd className="num font-semibold">{payments.length}</dd></div>
              <div><dt className="text-[11px] text-ink-soft">Tracked total</dt><dd className="num font-semibold">{formatCents(tracked.totalCents)}</dd></div>
              <div><dt className="text-[11px] text-ink-soft">Automatic updates</dt><dd className="font-semibold">{settings.sheetsAutoSync !== false ? 'On' : 'Off'}</dd></div>
            </dl>
          )}
          {connected && (settings.sheetsLastError || behind) && (
            <p className="mt-3 rounded-lg bg-pending/50 px-3 py-2 text-xs text-pending-ink">
              Your earnings are saved; only the spreadsheet report is behind. {settings.sheetsLastError ? <>Reconnect Google Sheets to update your report.<span className="mt-0.5 block text-ink-soft">Last problem: {settings.sheetsLastError}</span></> : 'Click Sync now to bring it up to date.'}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {connected ? (
              <>
                <Button variant={settings.sheetsLastError || behind ? 'accent' : 'outline'} onClick={syncNow} disabled={busy}><RefreshCw className={busy ? 'animate-spin' : ''} /> {busy ? 'Updating…' : settings.sheetsLastError ? 'Reconnect and sync' : 'Sync now'}</Button>
                {url && <Button asChild variant={settings.sheetsLastError || behind ? 'outline' : 'accent'}><a href={url} target="_blank" rel="noreferrer"><ExternalLink /> Open spreadsheet</a></Button>}
              </>
            ) : (
              <>
                <Button variant="accent" onClick={choose} disabled={busy}><FolderOpen /> {busy ? 'Working…' : 'Choose spreadsheet'}</Button>
                <Button variant="outline" onClick={createNew} disabled={busy}><FilePlus2 /> Create a new spreadsheet</Button>
              </>
            )}
          </div>
          {connected && (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={settings.sheetsAutoSync !== false} onChange={(e) => save({ sheetsAutoSync: e.target.checked })} />
              Update automatically after every saved change
            </label>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle>What ChaChing updates</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y divide-line text-sm">
            {WRITES.map(([t, d]) => (
              <li key={t} className="flex gap-3 py-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-paid-ink" />
                <span><b className="font-medium text-ink">{t}</b> <span className="text-ink-soft">— {d}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-soft">
            Your saved earnings in ChaChing are the main copy; a spreadsheet problem never undoes a saved import. ChaChing can open only the spreadsheet you choose here or one it created. Google
            access lasts about an hour in each browser tab; when it expires, ChaChing asks you to reconnect.
          </p>
        </CardContent>
      </Card>
    </>
  )
}
