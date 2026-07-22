// Pure, framework-neutral class computation (ported once, shared by both sides).
export type NgClassInput = string | string[] | Set<string> | Record<string, unknown>

export function normalizeClasses(value: NgClassInput): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.join(' ').trim()
  if (value instanceof Set) return [...value].join(' ').trim()
  return Object.entries(value)
    .filter(([, on]) => !!on)
    .map(([k]) => k)
    .join(' ')
    .trim()
}

const DIRECTION_CLASSES: Record<string, string> = {
  row: 'flex-row w-full',
  'row-reverse': 'flex-row-reverse w-full',
  column: 'flex-column h-full',
  'column-reverse': 'flex-column-reverse h-full',
}

export function slotGroupClassName(direction: string, custom: NgClassInput): string {
  const base = DIRECTION_CLASSES[direction] ?? DIRECTION_CLASSES.row
  return `flex justify-content-between ${base} ${normalizeClasses(custom)}`.trim().replace(/\s+/g, ' ')
}
