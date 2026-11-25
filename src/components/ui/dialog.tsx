import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Lightweight accessible modal built on the native <dialog> element. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'm-auto w-[calc(100%-1.5rem)] rounded-xl border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-ink/30',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between rounded-t-xl bg-title px-4 py-2.5">
            <h2 className="text-sm font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded p-1 hover:bg-white/60" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto px-4 py-3">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
