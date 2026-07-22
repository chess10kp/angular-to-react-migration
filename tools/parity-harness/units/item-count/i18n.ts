// Framework-neutral pure util (the kind you port first, with direct unit-test parity).
// Both the Angular and the React ItemCount import THIS — identical visible text by
// construction, so any divergence is a real rendering bug, not a copy drift.
export interface ItemRange {
  start: number
  end: number
  total: number
}

const CATALOG: Record<string, { showing: (r: ItemRange) => string; empty: string }> = {
  en: {
    showing: (r) => `Showing ${r.start}–${r.end} of ${r.total}`,
    empty: 'No items',
  },
  de: {
    showing: (r) => `Zeige ${r.start}–${r.end} von ${r.total}`,
    empty: 'Keine Einträge',
  },
}

export function itemRange(page: number | undefined, pageSize: number, total: number): ItemRange {
  const p = page && page > 0 ? page : 1
  if (total <= 0) return { start: 0, end: 0, total: 0 }
  const start = (p - 1) * pageSize + 1
  const end = Math.min(p * pageSize, total)
  return { start, end, total }
}

export function itemCountLabel(
  page: number | undefined,
  pageSize: number,
  total: number,
  locale = 'en',
): string {
  const cat = CATALOG[locale] ?? CATALOG.en
  const r = itemRange(page, pageSize, total)
  return r.total <= 0 ? cat.empty : cat.showing(r)
}
