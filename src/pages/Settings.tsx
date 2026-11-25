import { useEffect, useRef, useState } from 'react'
import { Download, FileJson, Upload } from 'lucide-react'
import { friendlyError, useAuth, useData } from '@/hooks/data'
import { markSheetSynced, useSheetsSync } from '@/hooks/sheets'
import { buildSheetModel, syncSpreadsheet } from '@/lib/sheets'
import { connectGoogleSheets, createSpreadsheet, pickSpreadsheet, sheetsApi } from '@/lib/sheetsClient'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/input'
import { firestoreDb } from '@/lib/firebase'
import { restoreBackup, saveSettings, validateBackup, type Backup } from '@/lib/store'
import { downloadFile, toBackup, toCsv } from '@/lib/export'
import { formatCents } from '@/lib/money'
import { DEFAULT_SETTINGS } from '@/lib/types'

export default function SettingsPage() {
  const { user } = useAuth()
  const { uid, settings, payments, meta } = useData()
  const learnedText = Object.entries(meta.projectMap ?? {}).map(([k, v]) => `${k} = ${v.join(', ')}`).join('\n')
  const [name, setName] = useState(settings.displayName ?? '')
  const [rates, setRates] = useState(settings.hourlyRates.join(', '))
  const [cycle, setCycle] = useState(String(settings.cycleStartDay))
  const [tol, setTol] = useState(String(settings.rateTolerancePct))
  const aliasText = (a?: Record<string, string>) => Object.entries(a ?? {}).map(([k, v]) => `${k} = ${v}`).join('\n')
  const [aliases, setAliases] = useState(aliasText(settings.contractAliases))
  const projText = (m?: Record<string, string[]>) => Object.entries(m ?? {}).map(([k, v]) => `${k} = ${v.join(', ')}`).join('\n')
  const [projMap, setProjMap] = useState(projText(settings.projectContracts))
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState<Backup | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(settings.displayName ?? '')
    setRates(settings.hourlyRates.join(', '))
    setCycle(String(settings.cycleStartDay))
    setTol(String(settings.rateTolerancePct))
    setAliases(Object.entries(settings.contractAliases ?? {}).map(([k, v]) => `${k} = ${v}`).join('\n'))
    setProjMap(Object.entries(settings.projectContracts ?? {}).map(([k, v]) => `${k} = ${v.join(', ')}`).join('\n'))
  }, [settings])

  const save = async () => {
    setErr(null)
    setMsg(null)
    const r = rates.split(/[,\s]+/).filter(Boolean).map(Number)
    if (!r.length || r.some((x) => !Number.isFinite(x) || x <= 0 || x > 1000)) return setErr('Hourly rates must be positive numbers, e.g. 65, 85.')
    const c = Number(cycle)
    if (!Number.isInteger(c) || c < 1 || c > 31) return setErr('Cycle start day must be between 1 and 31.')
    const t = Number(tol)
    if (!Number.isFinite(t) || t < 0 || t > 25) return setErr('Tolerance must be between 0 and 25%.')
    const contractAliases: Record<string, string> = {}
    for (const line of aliases.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [from, to] = line.split('=').map((x) => x?.trim())
      if (!from || !to) return setErr(`Alias lines must look like "dashboard name = My name": ${line}`)
      contractAliases[from] = to
    }
    const projectContracts: Record<string, string[]> = {}
    for (const line of projMap.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const i = line.indexOf('=')
      const proj = i > 0 ? line.slice(0, i).trim() : ''
      // Contract names may contain commas inside parentheses, so split on ", " only outside them
      const list = i > 0 ? line.slice(i + 1).split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean) : []
      if (!proj || !list.length) return setErr(`Project lines must look like "Project = Contract, Other contract": ${line}`)
      projectContracts[proj] = list
    }
    try {
      await saveSettings(firestoreDb, uid, { displayName: name.trim() || undefined, hourlyRates: r, cycleStartDay: c, rateTolerancePct: t, contractAliases, projectContracts, email: user?.email ?? null })
      setMsg('Settings saved to the cloud.')
    } catch (e) {
      setErr(`Settings were not saved. ${friendlyError(e)}`)
    }
  }

  const onFile = async (f: File | undefined) => {
    setErr(null)
    setMsg(null)
    if (!f) return
    try {
      if (f.size > 10_000_000) throw new Error('File is too large.')
      setPending(validateBackup(JSON.parse(await f.text())))
    } catch (e) {
      setErr(`Could not read backup: ${(e as Error).message}`)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const restore = async () => {
    if (!pending) return
    try {
      const r = await restoreBackup(firestoreDb, uid, pending)
      if (pending.settings && r.written) await saveSettings(firestoreDb, uid, { ...DEFAULT_SETTINGS, ...pending.settings, ...settings })
      setMsg(
        r.written
          ? `Saved ${r.written} payment${r.written === 1 ? '' : 's'} permanently to your cloud database.${r.skipped ? ` ${r.skipped} already existed and were left unchanged.` : ''} You won't need to restore this file again.`
          : `All ${r.skipped} payments in this file are already saved in your cloud database. Nothing was changed.`,
      )
      setPending(null)
    } catch (e) {
      setErr(`Restore failed — nothing was saved. ${friendlyError(e)}`)
    }
  }

  const stamp = new Date().toISOString().slice(0, 10)
  return (
    <>
      <PageHeader title="Settings" subtitle="Preferences, exports and backups" />
      {msg && <div className="mb-3 rounded-lg bg-paid px-3 py-2 text-sm text-paid-ink">{msg}</div>}
      {err && <div className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg bg-support p-2.5">
              {user?.photoURL ? <img src={user.photoURL} alt="" className="size-10 rounded-full" referrerPolicy="no-referrer" /> : <div className="size-10 rounded-full bg-title" />}
              <div className="text-sm">
                <div className="font-medium">{user?.displayName}</div>
                <div className="text-ink-soft">{user?.email}</div>
              </div>
            </div>
            <div>
              <Label htmlFor="s-name">Display name</Label>
              <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={user?.displayName ?? ''} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Earnings preferences</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="s-rates">Hourly rates (USD) used to infer rates from rounded hours</Label>
              <Input id="s-rates" value={rates} onChange={(e) => setRates(e.target.value)} placeholder="65, 85" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="s-cycle">Monthly cycle start day</Label>
                <Input id="s-cycle" type="number" min={1} max={31} value={cycle} onChange={(e) => setCycle(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="s-tol">Rate match tolerance (%)</Label>
                <Input id="s-tol" type="number" min={0} max={25} step={0.5} value={tol} onChange={(e) => setTol(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="s-alias">Contract name aliases (one per line: dashboard name = name in your records)</Label>
              <Textarea id="s-alias" rows={3} value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Long Dashboard contract name = Short name" className="text-xs" />
              <p className="mt-1 text-[11px] text-ink-soft">Usually not needed: a saved name contained in the dashboard's name (e.g. "Agent Work" inside "Acme Engineers (Agent Work Experience)") is matched automatically.</p>
            </div>
            <div>
              <Label htmlFor="s-proj">Project → contracts (one per line: Project = Contract, Contract)</Label>
              <Textarea id="s-proj" rows={4} value={projMap} onChange={(e) => setProjMap(e.target.value)} placeholder={learnedText || 'Alpha = Drafter'} className="text-xs" />
              <p className="mt-1 text-[11px] text-ink-soft">
                Leave empty to use the mapping learned automatically when a project's dashboard total exactly equals its contracts' payments.
                {learnedText && <> Learned now: <span className="font-mono">{learnedText.replace(/\n/g, '; ')}</span>{' '}<button type="button" className="underline" onClick={() => setProjMap(learnedText)}>Use these</button></>}
              </p>
            </div>
            <p className="text-[11px] text-ink-soft">Incentives and work trials never get an hourly rate. Cycle “21” means 21st through 20th of the next month.</p>
            <Button onClick={save}>Save settings</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Export</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-ink-soft">{payments.length} payments · {formatCents(payments.reduce((a, p) => a + p.earningsCents, 0))} stored</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => downloadFile(`rashio-${stamp}.csv`, toCsv(payments), 'text/csv')}><Download /> CSV</Button>
              <Button variant="outline" onClick={() => downloadFile(`rashio-backup-${stamp}.json`, JSON.stringify(toBackup(payments, { settings, meta }), null, 2), 'application/json')}><FileJson /> JSON backup</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Restore from JSON backup</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-ink-soft">For the one-time migration or emergency recovery only. Your data is already saved in the cloud and loads automatically when you sign in. Restoring only adds missing records; it never overwrites newer data or deletes anything.</p>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            {pending ? (
              <div className="rounded-lg bg-pending/60 p-2.5 text-sm">
                Restore <b>{pending.payments.length}</b> payments ({formatCents(pending.payments.reduce((a, p) => a + p.earningsCents, 0))}) exported {new Date(pending.exportedAt).toLocaleString()}?
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={restore}>Restore</Button>
                  <Button size="sm" variant="outline" onClick={() => setPending(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload /> Choose backup file</Button>
            )}
          </CardContent>
        </Card>
      </div>
      <SheetsCard />
      <BuildInfo />
    </>
  )
}

function SheetsCard() {
  const { uid, settings, payments, meta } = useData()
  const sheets = useSheetsSync()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const id = settings.sheetsSpreadsheetId
  const ready = !!id && settings.sheetsFileAccess === true
  const url = id ? `https://docs.google.com/spreadsheets/d/${id}` : null

  const save = async (patch: Partial<typeof settings>) => saveSettings(firestoreDb, uid, { ...settings, ...patch })

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setNote(null)
    try {
      await fn()
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const syncWithId = async (sheetId: string, extra: Partial<typeof settings> = {}) => {
    const model = buildSheetModel(payments, meta.projects, settings.cycleStartDay)
    const res = await syncSpreadsheet(sheetsApi(sheetId), model)
    markSheetSynced(meta.revision)
    await save({ ...extra, sheetsSpreadsheetId: sheetId, sheetsLastSyncAt: Date.now(), sheetsLastError: null })
    return `Google Sheet updated (${res.monthsWritten.length} month tabs${res.createdTabs.length ? `; added ${res.createdTabs.join(', ')}` : ''}).`
  }

  const choose = () =>
    run(async () => {
      await connectGoogleSheets() // Google popup: must start inside the click
      const picked = await pickSpreadsheet()
      if (!picked) return setNote({ ok: false, text: 'No spreadsheet chosen.' })
      const extra = { sheetsSpreadsheetName: picked.name, sheetsFileAccess: true, sheetsAutoSync: settings.sheetsAutoSync ?? true }
      await save({ ...extra, sheetsSpreadsheetId: picked.id })
      const msg = await syncWithId(picked.id, extra)
      setNote({ ok: true, text: `“${picked.name}” connected. ${msg}` })
    })

  const syncNow = () =>
    run(async () => {
      if (!sheets.connected) await connectGoogleSheets()
      setNote({ ok: true, text: await syncWithId(id!) })
    })

  const createNew = () =>
    run(async () => {
      await connectGoogleSheets()
      const newId = await createSpreadsheet('Rashio earnings')
      const extra = { sheetsSpreadsheetName: 'Rashio earnings', sheetsFileAccess: true, sheetsAutoSync: true }
      await save({ ...extra, sheetsSpreadsheetId: newId })
      const msg = await syncWithId(newId, extra)
      setNote({ ok: true, text: `Created “Rashio earnings” in your Google Drive. ${msg}` })
    })

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Google Sheets reporting copy</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-ink-soft">
          After every saved change — imports, edits, deletes, status changes — Rashio updates your spreadsheet: the monthly tabs, the Overview sections and a raw “Earnings data” tab.
          Your formulas, formatting and charts are kept; a new month tab is created by copying the latest one. Your cloud database stays the main copy.
        </p>

        {id && !ready && (
          <div className="rounded-lg bg-pending/70 px-3 py-2 text-pending-ink">
            <b>One-time step:</b> Rashio now uses a safer permission that only covers the spreadsheet you choose. Click <b>Choose spreadsheet</b> and select{' '}
            {url ? <a className="underline" href={url} target="_blank" rel="noreferrer">your earnings sheet</a> : 'your earnings sheet'} once.
          </div>
        )}

        {ready && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-paid/60 px-3 py-2 text-paid-ink">
            Connected to <b>{settings.sheetsSpreadsheetName || 'your spreadsheet'}</b>
            {url && <a className="underline" href={url} target="_blank" rel="noreferrer">Open</a>}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={settings.sheetsAutoSync !== false} disabled={!ready} onChange={(e) => save({ sheetsAutoSync: e.target.checked })} />
          Update the spreadsheet automatically after each change
        </label>

        <div className="flex flex-wrap gap-2">
          {ready ? (
            <>
              <Button onClick={syncNow} disabled={busy}>{busy ? 'Working…' : 'Sync now'}</Button>
              <Button variant="outline" onClick={choose} disabled={busy}>Choose a different spreadsheet</Button>
            </>
          ) : (
            <Button onClick={choose} disabled={busy}>{busy ? 'Working…' : 'Choose spreadsheet'}</Button>
          )}
          <Button variant="outline" onClick={createNew} disabled={busy}>Create a new spreadsheet</Button>
        </div>

        {note && <div className={note.ok ? 'rounded-lg bg-paid px-3 py-2 text-paid-ink' : 'rounded-lg bg-danger/10 px-3 py-2 text-danger'}>{note.text}</div>}
        <p className="text-[11px] text-ink-soft">
          {settings.sheetsLastSyncAt ? `Last updated ${new Date(settings.sheetsLastSyncAt).toLocaleString()}. ` : ''}
          {settings.sheetsLastError ? `Last problem: ${settings.sheetsLastError} ` : ''}
          Uses your own Google sign-in. Rashio can only open spreadsheets you choose here or that it created — not the rest of your Drive. Access lasts about an hour per browser tab; Google re-asks with a quick popup when needed. The spreadsheet must be editable by the Google account you use for Rashio.
        </p>
      </CardContent>
    </Card>
  )
}

function BuildInfo() {
  const [live, setLive] = useState<{ sha: string; time: string } | null>(null)
  useEffect(() => {
    fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setLive)
      .catch(() => setLive(null))
  }, [])
  const b = __APP_BUILD__
  const outdated = live && live.sha !== b.sha
  return (
    <div className="mt-4 rounded-lg bg-support px-3 py-2 text-xs text-ink-soft">
      App version <span className="font-mono text-ink">{b.sha}{b.dirty ? '+local' : ''}</span> · built {new Date(b.time).toLocaleString()}
      {outdated && (
        <span className="ml-2 text-pending-ink">
          A newer version ({live.sha}) is deployed — <button className="underline" onClick={() => window.location.reload()}>reload</button>
        </span>
      )}
      {live && !outdated && <span className="ml-2 text-paid-ink">✓ latest deployed version</span>}
    </div>
  )
}
