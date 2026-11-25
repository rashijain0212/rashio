// Browser client for the Google Sheets API using the signed-in user's own
// Google OAuth token (no server, no stored secrets). The token is requested via
// a Google popup with the spreadsheets scope and kept in memory only (~1 hour).

import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth'
import { auth } from './firebase'
import type { Grid, SheetsApi, TabInfo } from './sheets'

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
let token: { value: string; expiresAt: number } | null = null

export function hasSheetsToken(): boolean {
  return !!token && token.expiresAt > Date.now() + 60_000
}

/** Must be called from a click handler (it may open a Google popup). */
export async function connectGoogleSheets(): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('Sign in first.')
  const provider = new GoogleAuthProvider()
  provider.addScope(SCOPE)
  provider.setCustomParameters({ login_hint: user.email ?? '', prompt: 'consent' })
  const res = await reauthenticateWithPopup(user, provider)
  const cred = GoogleAuthProvider.credentialFromResult(res)
  if (!cred?.accessToken) throw new Error('Google did not grant access to Google Sheets.')
  token = { value: cred.accessToken, expiresAt: Date.now() + 55 * 60_000 }
}

export function disconnectGoogleSheets() {
  token = null
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  if (!hasSheetsToken()) throw new SheetsAuthError()
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token!.value}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  if (res.status === 401) {
    token = null
    throw new SheetsAuthError()
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg = body?.error?.message ?? res.statusText
    if (res.status === 403) throw new Error(`Google Sheets refused access (${msg}). Make sure this Google account can edit the spreadsheet.`)
    if (res.status === 404) throw new Error('Spreadsheet not found. Check the link in Settings.')
    throw new Error(`Google Sheets error: ${msg}`)
  }
  return res.json() as Promise<T>
}

export class SheetsAuthError extends Error {
  constructor() {
    super('Connect Google Sheets to update your spreadsheet.')
    this.name = 'SheetsAuthError'
  }
}

export function sheetsApi(spreadsheetId: string): SheetsApi {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
  const enc = (r: string) => encodeURIComponent(r)
  return {
    async tabs() {
      const r = await call<{ sheets: { properties: TabInfo }[] }>(`${base}?fields=sheets.properties(title,sheetId,index)`)
      return r.sheets.map((s) => s.properties)
    },
    async read(title) {
      const r = await call<{ values?: Grid }>(`${base}/values/${enc(`'${title.replace(/'/g, "''")}'!A1:Z400`)}?valueRenderOption=FORMULA`)
      return r.values ?? []
    },
    async batch(requests) {
      return call(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) })
    },
    async write(data, mode) {
      if (!data.length) return
      await call(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: mode, data }) })
    },
    async clear(range) {
      await call(`${base}/values/${enc(range)}:clear`, { method: 'POST', body: '{}' })
    },
  }
}

/** Create a new spreadsheet in the user's Drive (Overview/month tabs are added by the first sync). */
export async function createSpreadsheet(title: string): Promise<string> {
  const r = await call<{ spreadsheetId: string }>('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: 'Overview' } }] }),
  })
  return r.spreadsheetId
}
