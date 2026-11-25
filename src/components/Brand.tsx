import { cn } from '@/lib/utils'

// ChaChing mark: a two-tone rounded C (periwinkle + soft blue) with a small gold
// sparkle and mint chime strokes. Same geometry as design/brand/generate.py.
function Mark({ chime = true, sparkle = true }: { chime?: boolean; sparkle?: boolean }) {
  return (
    <>
      <path d="M36.72 23A14 14 0 0 0 12.84 27.21" fill="none" stroke="#6C5CE7" strokeWidth="10" />
      <circle cx="36.72" cy="23" r="5" fill="#6C5CE7" />
      <path d="M36.72 41A14 14 0 0 1 12.84 27.21" fill="none" stroke="#88ABF5" strokeWidth="10" />
      <circle cx="36.72" cy="41" r="5" fill="#88ABF5" />
      {sparkle && <path d="M44 26.5Q44.9 31.1 49.5 32Q44.9 32.9 44 37.5Q43.1 32.9 38.5 32Q43.1 31.1 44 26.5Z" fill="#FFC857" />}
      {chime && <path d="M51 24l4-3.2M52 32h5M51 40l4 3.2" stroke="#5CCB9C" strokeWidth="2.6" strokeLinecap="round" fill="none" />}
    </>
  )
}

/** App icon: the mark on a soft lavender tile. `small` drops the chime strokes for tiny sizes. */
export function BrandIcon({ className, small }: { className?: string; small?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn('size-8 shrink-0', className)}>
      <rect width="64" height="64" rx="16" fill="#EAE6FF" />
      <g transform={small ? 'translate(3 0)' : undefined}>
        <Mark chime={!small} />
      </g>
    </svg>
  )
}

/** Wordmark: ChaChing, exact casing, in slate. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={cn('font-bold tracking-tight text-brand-ink', className)}>ChaChing</span>
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrandIcon />
      <Wordmark className="text-[17px]" />
    </span>
  )
}
