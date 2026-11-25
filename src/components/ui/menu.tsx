import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Small "⋯" actions menu. Keyboard: Enter/Space opens and focuses the first item,
 *  ↑/↓ move between items, Escape closes and returns focus to the button. */
export function ActionsMenu({ label, items, align = 'right' }: { label: string; items: { label: string; onSelect: () => void; danger?: boolean; icon?: ReactNode }[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const menuItems = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])]
  useEffect(() => {
    if (!open) return
    menuItems()[0]?.focus()
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      btn.current?.focus()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="relative inline-block" ref={ref}>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-support hover:text-ink"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const list = menuItems()
            const i = list.indexOf(document.activeElement as HTMLButtonElement)
            list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus()
          }}
          className={cn('absolute z-30 mt-1 min-w-44 rounded-xl border border-line bg-white p-1 text-sm shadow-lg', align === 'right' ? 'right-0' : 'left-0')}>
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                it.onSelect()
              }}
              className={cn('flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left', it.danger ? 'text-danger hover:bg-danger/10' : 'hover:bg-support')}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
