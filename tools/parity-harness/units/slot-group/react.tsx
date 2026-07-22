// Target side: the React port of SlotGroup. Same debounced-resize contract via a
// ResizeObserver + a 100ms timer, same class/style inputs, and useEffect cleanup as
// the teardown analogue of ngOnDestroy.
import * as React from 'react'
import type { DomainEvent } from '../../src/types.js'
import { slotGroupClassName, type NgClassInput } from './classes.js'

export interface SlotGroupProps {
  name?: string
  direction?: 'row' | 'row-reverse' | 'column' | 'column-reverse'
  slotGroupClasses?: NgClassInput
  gap?: string
  onEvent?: (e: DomainEvent) => void
}

export function SlotGroup({
  name = '',
  direction = 'row',
  slotGroupClasses = '',
  gap = '',
  onEvent,
}: SlotGroupProps) {
  const elRef = React.useRef<HTMLDivElement | null>(null)
  const setRef = React.useCallback((el: HTMLDivElement | null) => {
    elRef.current = el
  }, [])

  React.useEffect(() => {
    const el = elRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect || rect.width < 0) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        onEvent?.({ name: 'slotGroupResized', payload: { name, width: rect.width, height: rect.height } })
      }, 100)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [name, onEvent])

  return (
    <div className={slotGroupClassName(direction, slotGroupClasses)} style={{ gap }} data-region="container" ref={setRef}>
      <span data-slot="start">{name}.start</span>
      <span data-slot="center">{name}.center</span>
      <span data-slot="end">{name}.end</span>
    </div>
  )
}
