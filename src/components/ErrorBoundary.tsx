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
        <h2 className="mb-1 text-base font-semibold">{update ? 'A new version of ChaChing is available' : "This page couldn't load"}</h2>
        <p className="mb-3 text-ink-soft">
          {update ? 'Reload to get the latest version. Your saved earnings are not affected.' : 'Your saved earnings are safe in the cloud. Try again, or open another page from the menu.'}
        </p>
        {!update && <details className="mb-3 text-[11px] text-ink-soft"><summary className="cursor-pointer">Details</summary><pre className="mt-1 max-h-24 overflow-auto rounded bg-support p-2">{this.state.error.message}</pre></details>}
        <div className="flex gap-2">
          {!update && <button className="rounded-lg bg-accent px-3 py-2 font-medium text-white" onClick={() => this.setState({ error: null })}>Try again</button>}
          <button className={update ? 'rounded-lg bg-accent px-3 py-2 font-medium text-white' : 'rounded-lg border border-line px-3 py-2 font-medium'} onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}
