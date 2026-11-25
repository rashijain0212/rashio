import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '@/hooks/data'
import { markSheetSynced, sheetSyncedRevision, useSheetsSync } from '@/hooks/sheets'
import { hasSheetsToken } from '@/lib/sheetsClient'

/**
 * Keeps the Google Sheet in step with every saved change (imports, edits,
 * deletes, status changes, undo, restore). Runs a few seconds after the data
 * revision changes, only while Google access is available in this tab.
 */
export function AutoSheetSync() {
  const { meta, payments, loading } = useData()
  const { auto, sync } = useSheetsSync()
  const [needsConnect, setNeedsConnect] = useState(false)
  const first = useRef(true)

  useEffect(() => {
    if (loading || !auto) return
    // The first snapshot after opening the app is the baseline, not a change.
    if (first.current) {
      first.current = false
      markSheetSynced(meta.revision)
      return
    }
    if (meta.revision <= sheetSyncedRevision()) return
    if (!hasSheetsToken()) {
      setNeedsConnect(true)
      return
    }
    const rev = meta.revision
    const t = setTimeout(() => {
      markSheetSynced(rev)
      setNeedsConnect(false)
      sync({ payments }).catch(() => undefined)
    }, 2500)
    return () => clearTimeout(t)
  }, [meta.revision, payments, loading, auto, sync])

  if (!needsConnect) return null
  return (
    <Link to="/spreadsheets" className="block rounded-lg bg-pending/70 px-2.5 py-1.5 text-[11px] text-pending-ink underline">
      Spreadsheet not updated — reconnect Google Sheets
    </Link>
  )
}
