import { useCallback, useState } from 'react'
import { useData } from './data'
import { firestoreDb } from '@/lib/firebase'
import { saveSettings } from '@/lib/store'
import { buildSheetModel, syncSpreadsheet } from '@/lib/sheets'
import { connectGoogleSheets, hasSheetsToken, sheetsApi, SheetsAuthError } from '@/lib/sheetsClient'
import type { ParsedProject, Payment } from '@/lib/types'

let lastSyncedRevision = -1
/** Remember that the spreadsheet reflects this data revision (avoids double syncs). */
export function markSheetSynced(revision: number) {
  lastSyncedRevision = Math.max(lastSyncedRevision, revision)
}
export function sheetSyncedRevision() {
  return lastSyncedRevision
}

export type SheetsState = { kind: 'idle' | 'syncing' | 'ok' | 'error'; message?: string }

/** Push the current Firestore data to the user's Google Sheet (reporting copy). */
export function useSheetsSync() {
  const { uid, payments, meta, settings } = useData()
  const [state, setState] = useState<SheetsState>({ kind: 'idle' })
  const configured = !!settings.sheetsSpreadsheetId && settings.sheetsFileAccess === true
  const auto = configured && settings.sheetsAutoSync !== false

  /** Call at the start of a click handler: opens Google's popup if access is needed. */
  const ensureAccess = useCallback(async () => {
    if (!configured || hasSheetsToken()) return true
    try {
      await connectGoogleSheets()
      return true
    } catch (e) {
      setState({ kind: 'error', message: `Google Sheets not connected: ${(e as Error).message}` })
      return false
    }
  }, [configured])

  const sync = useCallback(
    async (opts: { payments?: Payment[]; projects?: ParsedProject[] } = {}) => {
      if (!settings.sheetsSpreadsheetId) return null
      setState({ kind: 'syncing' })
      const record = (patch: { sheetsLastSyncAt?: number | null; sheetsLastError?: string | null }) =>
        saveSettings(firestoreDb, uid, { ...settings, ...patch }).catch(() => undefined)
      try {
        const model = buildSheetModel(opts.payments ?? payments, opts.projects ?? meta.projects, settings.cycleStartDay)
        const res = await syncSpreadsheet(sheetsApi(settings.sheetsSpreadsheetId), model)
        const msg = `Google Sheet updated (${res.monthsWritten.length} month tab${res.monthsWritten.length === 1 ? '' : 's'}${res.createdTabs.length ? `; added ${res.createdTabs.join(', ')}` : ''}).`
        setState({ kind: 'ok', message: msg })
        await record({ sheetsLastSyncAt: Date.now(), sheetsLastError: null })
        return msg
      } catch (e) {
        const message = e instanceof SheetsAuthError ? e.message : `Google Sheet not updated: ${(e as Error).message}`
        setState({ kind: 'error', message })
        if (!(e instanceof SheetsAuthError)) await record({ sheetsLastError: message })
        throw new Error(message)
      }
    },
    [uid, payments, meta.projects, settings],
  )

  return { state, configured, auto, ensureAccess, sync, connected: hasSheetsToken() }
}
