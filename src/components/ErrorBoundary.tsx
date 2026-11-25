import { Component, type ComponentType, type ReactNode, lazy } from 'react'

const RELOAD_KEY = 'mt-reloaded-for-update'

function isChunkError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e)
  return /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically|MIME type|ChunkLoadError/i.test(m)
}

/** Reload once to pick up a newer deployment when a page's code file is gone. */
function reloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 30000) return false // avoid reload loops
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    /* storage unavailable: still try once */
  }
  window.location.reload()
  return true
}

/** React.lazy that reloads the app once if the code was replaced by a new deploy. */
export function lazyPage<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((e) => {
      if (isChunkError(e) && reloadForUpdate()) return new Promise<{ default: T }>(() => {})
      throw e
    }),
  )
}

/** Never show a blank page: catch render errors and offer a reload. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    if (isChunkError(error)) reloadForUpdate()
  }
  render() {
    if (!this.state.error) return this.props.children
    const update = isChunkError(this.state.error)
    return (
      <div className="mx-auto mt-10 max-w-md rounded-xl border border-line bg-white p-5 text-sm shadow-sm" role="alert">
        <h2 className="mb-1 text-base font-semibold">{update ? 'A new version is available' : 'Something went wrong on this page'}</h2>
        <p className="mb-3 text-ink-soft">
          {update ? 'Rashio was updated while this tab was open. Reload to continue.' : 'Your data is safe in the cloud. Reload the page to continue.'}
        </p>
        {!update && <pre className="mb-3 max-h-24 overflow-auto rounded bg-support p-2 text-[11px]">{this.state.error.message}</pre>}
        <button className="rounded-lg bg-ink px-3 py-2 font-medium text-white" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
