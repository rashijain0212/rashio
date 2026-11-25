import type { ReactNode } from 'react'
import { StaticDataProvider } from '@/hooks/data'
import { DEFAULT_SETTINGS } from '@/lib/types'
import { demoMeta, demoPayments } from './demoData'

export default function DemoGate({ children }: { children: ReactNode }) {
  return (
    <StaticDataProvider value={{ uid: 'demo', payments: demoPayments, meta: demoMeta, settings: DEFAULT_SETTINGS, imports: [] }}>
      {children}
    </StaticDataProvider>
  )
}
