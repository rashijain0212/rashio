// Browser client for the Google Sheets API using the signed-in user's own
// Google OAuth token (no server, no stored secrets). The token is requested via
// a Google popup and kept in memory only (~1 hour).
//
// Permission is "drive.file": Rashio can only open spreadsheets it created or
// that the user picked with Google's file picker — not the rest of their Drive.
// Google treats this as non-sensitive, so no "unverified app" warning appears.

import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth'
import { auth } from './firebase'
import type { Grid, SheetsApi, TabInfo } from './sheets'

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
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
    if (res.status === 403 || res.status === 404) throw new SheetsNoFileAccessError(msg)
    throw new Error(`Google Sheets error: ${msg}`)
  }
  return res.json() as Promise<T>
}

/** Rashio has not been given access to this spreadsheet (pick it once in Settings). */
export class SheetsNoFileAccessError extends Error {
  constructor(detail: string) {
    super(`Rashio can't open this spreadsheet yet. In Settings, click "Choose spreadsheet" and select it once. (${detail})`)
    this.name = 'SheetsNoFileAccessError'
  }
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

// ---------------------------------------------------------------- Google file picker

declare global {
  interface Window {
    gapi?: { load: (lib: string, cb: () => void) => void }
    google?: { picker: any } // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

let pickerLoaded: Promise<void> | null = null
function loadPicker(): Promise<void> {
  pickerLoaded ??= new Promise<void>((resolve, reject) => {
    const done = () => window.gapi!.load('picker', () => resolve())
    if (window.gapi) return done()
    const s = document.createElement('script')
    s.src = 'https://apis.google.com/js/api.js'
    s.async = true
    s.onload = done
    s.onerror = () => {
      pickerLoaded = null
      reject(new Error('Could not load the Google file picker. Check your connection and try again.'))
    }
    document.head.appendChild(s)
  })
  return pickerLoaded
}

/**
 * Opens Google's file picker (inside the page) so the user can choose the
 * spreadsheet Rashio may edit. Needs a token from connectGoogleSheets().
 * Resolves with the spreadsheet id, or null if the user closed the picker.
 */
export async function pickSpreadsheet(): Promise<{ id: string; name: string } | null> {
  if (!hasSheetsToken()) throw new SheetsAuthError()
  await loadPicker()
  const g = window.google!.picker
  const env = import.meta.env
  return new Promise((resolve) => {
    const view = new g.DocsView(g.ViewId.SPREADSHEETS).setIncludeFolders(true).setSelectFolderEnabled(false).setMode(g.DocsViewMode.LIST)
    const picker = new g.PickerBuilder()
      .addView(view)
      .setOAuthToken(token!.value)
      .setDeveloperKey(env.VITE_FIREBASE_API_KEY)
      .setAppId(env.VITE_FIREBASE_MESSAGING_SENDER_ID)
      .setTitle('Choose the spreadsheet Rashio may update')
      .setCallback((data: { action: string; docs?: { id: string; name: string }[] }) => {
        if (data.action === g.Action.PICKED && data.docs?.[0]) resolve({ id: data.docs[0].id, name: data.docs[0].name })
        else if (data.action === g.Action.CANCEL) resolve(null)
      })
      .build()
    picker.setVisible(true)
  })
}
