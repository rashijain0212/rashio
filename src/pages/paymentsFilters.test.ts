// Layout contract for the All payments filter bar. The date boxes carry a small
// label above them and the search/status/type boxes do not, so the grid must
// align its cells to the bottom for every box to sit on one line. (Checked
// visually at 1440px: all seven boxes share the same top and height.)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(resolve(import.meta.dirname, 'Payments.tsx'), 'utf8')
const bar = src.match(/<CardContent className="([^"]*)">([\s\S]*?)<\/CardContent>/)

describe('All payments filter bar', () => {
  it('exists', () => {
    expect(bar).not.toBeNull()
  })

  it('bottom-aligns every box so labelled and unlabelled boxes share one line', () => {
    expect(bar![1].split(/\s+/)).toEqual(expect.arrayContaining(['grid', 'items-end']))
  })

  it('fits all seven filters in one row on wide screens (search spans two columns)', () => {
    expect(bar![1]).toMatch(/\blg:grid-cols-8\b/)
    expect(bar![2]).toMatch(/className="relative col-span-2"/)
    const boxes = (bar![2].match(/<(Input|Select)\b/g) ?? []).length
    expect(boxes).toBe(7)
  })

  it('keeps every date box inside a visible label', () => {
    const dates = bar![2].match(/<label[^>]*>[^<]*<Input type="date"/g) ?? []
    expect(dates).toHaveLength(4)
  })
})
