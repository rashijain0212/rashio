import { useEffect, useRef, useState } from 'react'
import { FileJson, Upload } from 'lucide-react'
import { friendlyError, useAuth, useData } from '@/hooks/data'
import { PageHeader } from '@/components/PageHeader'
import { BrandIcon, Wordmark } from '@/components/Brand'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/input'
import { firestoreDb } from '@/lib/firebase'
import { restoreBackup, saveSettings, validateBackup, type Backup } from '@/lib/store'
import { downloadFile, toBackup } from '@/lib/export'
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

  const dirty =
    name !== (settings.displayName ?? '') ||
    rates !== settings.hourlyRates.join(', ') ||
    cycle !== String(settings.cycleStartDay) ||
    tol !== String(settings.rateTolerancePct) ||
    aliases !== aliasText(settings.contractAliases) ||
    projMap !== projText(settings.projectContracts)

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
      <PageHeader title="Settings" subtitle="Your profile, preferences, data and recovery." />
      {msg && <div className="mb-3 rounded-xl bg-paid px-4 py-2.5 text-sm text-paid-ink" role="status">{msg}</div>}
      {err && <div className="mb-3 rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger" role="alert">{err}</div>}
      <div className="mx-auto max-w-3xl space-y-4">
        <Section title="Profile" hint="How you appear in ChaChing">
          <div className="flex items-center gap-3 rounded-xl bg-support/70 p-3">
            {user?.photoURL ? <img src={user.photoURL} alt="" className="size-10 rounded-full" referrerPolicy="no-referrer" /> : <div className="size-10 rounded-full bg-brand" />}
            <div className="min-w-0 text-sm">
              <div className="truncate font-medium">{user?.displayName}</div>
              <div className="truncate text-ink-soft">{user?.email}</div>
            </div>
          </div>
          <div>
            <Label htmlFor="s-name">Display name</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={user?.displayName ?? ''} />
          </div>
        </Section>

        <Section title="Earnings preferences" hint="Used for hourly rates and monthly cycles.">
          <div>
            <Label htmlFor="s-rates">Your hourly rates (USD), used to tidy up rates from rounded hours</Label>
            <Input id="s-rates" value={rates} onChange={(e) => setRates(e.target.value)} placeholder="65, 85" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="s-cycle">Monthly cycle starts on day</Label>
              <Input id="s-cycle" type="number" min={1} max={31} value={cycle} onChange={(e) => setCycle(e.target.value)} />
              <p className="mt-1 text-[11px] text-ink-soft">“21” means the 21st through the 20th of the next month.</p>
            </div>
            <div>
              <Label htmlFor="s-tol">Rate match tolerance (%)</Label>
              <Input id="s-tol" type="number" min={0} max={25} step={0.5} value={tol} onChange={(e) => setTol(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-ink-soft">Incentives and work trials never get an hourly rate.</p>
        </Section>

        <Section title="Contracts & projects" hint="Only needed when automatic matching isn't enough.">
          <div>
            <Label htmlFor="s-alias">Contract name aliases — one per line: name on the dashboard = name in your records</Label>
            <Textarea id="s-alias" rows={3} value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Long dashboard contract name = Short name" className="text-xs" />
            <p className="mt-1 text-[11px] text-ink-soft">Usually not needed: a saved name contained in the dashboard's name is matched automatically.</p>
          </div>
          <div>
            <Label htmlFor="s-proj">Project → contracts — one per line: Project = Contract, Contract</Label>
            <Textarea id="s-proj" rows={4} value={projMap} onChange={(e) => setProjMap(e.target.value)} placeholder={learnedText || 'Alpha = Drafter'} className="text-xs" />
            <p className="mt-1 text-[11px] text-ink-soft">
              Leave empty to use the suggestion ChaChing learns when a project's total exactly matches its contracts.
              {learnedText && <> Suggested: <span className="font-mono">{learnedText.replace(/\n/g, '; ')}</span>{' '}<button type="button" className="underline" onClick={() => setProjMap(learnedText)}>Use these</button></>}
            </p>
          </div>
        </Section>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-xs text-ink-soft" role="status">{dirty ? 'Unsaved changes' : 'All preferences saved'}</span>
          <Button variant="accent" onClick={save} disabled={!dirty}>Save preferences</Button>
        </div>

        <Section title="Data & recovery" hint="Your data lives in the cloud; these are copies for you.">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-sm text-ink-soft">{payments.length} payments · {formatCents(payments.reduce((a, p) => a + p.earningsCents, 0))} saved</span>
            <Button variant="outline" onClick={() => downloadFile(`chaching-backup-${stamp}.json`, JSON.stringify(toBackup(payments, { settings, meta }), null, 2), 'application/json')}><FileJson /> Download JSON backup</Button>
          </div>
          <div className="border-t border-line pt-3">
            <div className="text-sm font-medium">Restore from a backup</div>
            <p className="mb-2 text-xs text-ink-soft">For recovery only. Restoring inserts payments that are missing; it never overwrites newer records or deletes anything. A spreadsheet-friendly CSV is on the Payments page.</p>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            {pending ? (
              <div className="rounded-xl bg-pending/60 p-3 text-sm">
                Restore <b>{pending.payments.length}</b> payments ({formatCents(pending.payments.reduce((a, p) => a + p.earningsCents, 0))}) from a backup made {new Date(pending.exportedAt).toLocaleString()}?
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={restore}>Restore</Button>
                  <Button size="sm" variant="outline" onClick={() => setPending(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload /> Choose backup file</Button>
            )}
          </div>
        </Section>

        <Section title="About">
          <div className="flex items-center gap-3">
            <BrandIcon className="size-11" />
            <div>
              <div className="text-lg"><Wordmark /></div>
              <div className="text-sm italic text-brand-ink/80">Every hour. Every earning.</div>
              <div className="text-xs text-ink-soft">Your personal income intelligence.</div>
            </div>
          </div>
          <BuildInfo />
        </Section>
      </div>
    </>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-0">
        <CardTitle>{title}</CardTitle>
        {hint && <p className="text-xs text-ink-soft">{hint}</p>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
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
    <div className="rounded-lg bg-support/70 px-3 py-2 text-xs text-ink-soft">
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
