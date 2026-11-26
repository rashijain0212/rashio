// Guards for what may live in the public repository and for the hosting setup.
// These run in CI on every push, so a mistake is caught before it is merged.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

function trackedFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter((f) => f && !/\.(png|jpe?g|gif|ico|webp|woff2?|ttf|pdf)$/i.test(f) && f !== 'package-lock.json')
  } catch {
    return [] // not a git checkout (e.g. a source tarball): nothing to guard
  }
}

// The earnings platform's name must never appear in the repository. It is kept
// here encoded so this file does not contain it either.
const FORBIDDEN_NAMES = ['bWVyY29y'].map((b) => Buffer.from(b, 'base64').toString('utf8'))

describe('public repository hygiene', () => {
  const files = trackedFiles()

  it('never tracks private data, credentials or local project settings', () => {
    const bad = files.filter(
      (f) =>
        /^private\//.test(f) ||
        /(^|\/)\.env(\.|$)(?!example$)/.test(f) ||
        /(^|\/)\.firebaserc$/.test(f) ||
        /service-account.*\.json$|-credentials\.json$/i.test(f),
    )
    expect(bad).toEqual([])
  })

  it('contains no private keys, tokens or links to a real spreadsheet', () => {
    const hits: string[] = []
    for (const f of files) {
      const t = read(f)
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"\s*:|ya29\.[\w-]{20,}|1\/\/0[\w-]{30,}/.test(t)) hits.push(`${f}: credential`)
      // Synthetic fixture ids spell out the alphabet (e.g. 1AbCdEf...); anything else looks real.
      for (const m of t.matchAll(/docs\.google\.com\/spreadsheets\/d\/([\w-]{25,})/g)) if (!/AbCdEf/.test(m[1])) hits.push(`${f}: spreadsheet link`)
    }
    expect(hits).toEqual([])
  })

  it('never names the earnings platform', () => {
    const hits = files.filter((f) => FORBIDDEN_NAMES.some((n) => new RegExp(n, 'i').test(f) || new RegExp(n, 'i').test(read(f))))
    expect(hits).toEqual([])
  })

  it('does not contain the local Firebase project id', () => {
    const rc = resolve(ROOT, '.firebaserc')
    if (!existsSync(rc)) return // CI has no local project mapping
    const ids = Object.values((JSON.parse(readFileSync(rc, 'utf8')) as { projects: Record<string, string> }).projects)
    const hits = files.filter((f) => ids.some((id) => read(f).includes(id)))
    expect(hits).toEqual([])
  })
})

describe('hosting configuration', () => {
  const live = read('README.md').match(/^Live: (https:\/\/[\w.-]+)$/m)?.[1]
  const fb = JSON.parse(read('firebase.json')) as {
    hosting: Array<{ target: string; public: string; rewrites?: Array<{ source: string; destination: string }>; redirects?: Array<{ source: string; destination: string; type: number }> }>
  }

  it('README names the live address', () => {
    expect(live).toMatch(/^https:\/\/[\w-]+\.web\.app$/)
  })

  it('serves the built app as a single-page app', () => {
    const app = fb.hosting.find((h) => h.target === 'app')!
    expect(app.public).toBe('dist')
    expect(app.rewrites).toContainEqual({ source: '**', destination: '/index.html' })
  })

  it('every old address forwards to the live address, keeping the path', () => {
    const redirects = fb.hosting.filter((h) => h.target !== 'app')
    expect(redirects.length).toBeGreaterThan(0)
    for (const h of redirects) expect(h.redirects).toEqual([{ source: '/:path*', destination: `${live}/:path*`, type: 301 }])
    const page = read('legacy-redirect/index.html')
    for (const url of page.match(/https:\/\/[\w.-]+/g) ?? []) expect(url).toBe(live)
  })
})
