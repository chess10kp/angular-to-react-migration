// Target side: the React port of ItemCountComponent. Same pure i18n util, same
// role=status span, same domain event on render.
import * as React from 'react'
import type { DomainEvent } from '../../src/types.js'
import { itemCountLabel, itemRange } from './i18n.js'

export interface ItemCountProps {
  page?: number
  pageSize?: number
  total?: number
  locale?: string
  onEvent?: (e: DomainEvent) => void
}

export function ItemCount({ page, pageSize = 10, total = 0, locale = 'en', onEvent }: ItemCountProps) {
  const label = itemCountLabel(page, pageSize, total, locale)
  React.useEffect(() => {
    onEvent?.({ name: 'itemCountRendered', payload: itemRange(page, pageSize, total) })
  }, [page, pageSize, total, locale, onEvent])
  return <span role="status">{label}</span>
}
