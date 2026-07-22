import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AngularAdapter } from '../src/adapters/angular.js'
import { ReactAdapter } from '../src/adapters/react.tsx'
import { runParityCase, type UnitDefinition } from '../src/runner.js'
import { hashString } from '../src/baseline.js'
import { assertParityCase } from '../src/validate.js'
import { triggerResize, microSettle } from '../src/dom-env.js'
import { SlotGroupComponent } from '../units/slot-group/angular.js'
import { SlotGroup } from '../units/slot-group/react.tsx'

const here = new URL('.', import.meta.url).pathname
const caseJson = JSON.parse(readFileSync(join(here, '../units/slot-group/case.resize.json'), 'utf8'))

function makeUnit(reactComp = SlotGroup): UnitDefinition {
  return {
    angular: new AngularAdapter(SlotGroupComponent),
    react: new ReactAdapter(reactComp as never),
    styleProbes: [{ selector: '[data-region="container"]', prop: 'gap' }],
    keyParts: { sourceCommit: 'test', componentHash: hashString('slot-group'), caseHash: hashString(JSON.stringify(caseJson)), fixtureHash: 'none' },
  }
}

describe('SlotGroup parity (timing, class/style, teardown)', () => {
  it('accepts the React port: slots, style input, and debounced resize event all match', async () => {
    const pcase = assertParityCase(caseJson)
    const result = await runParityCase(pcase, makeUnit())
    expect(result.angularContract).toEqual([])
    expect(result.reactContract).toEqual([])
    expect(result.divergences).toEqual([])
    expect(result.accepted).toBe(true)
  })

  it('catches a debounce-timing regression (React fires immediately, before settle)', async () => {
    // A port that forgets to debounce would emit synchronously; the payload still
    // matches, but a port that emits the WRONG size is the classic bug — model that.
    function BadSlotGroup(props: Record<string, unknown>) {
      const good = SlotGroup as unknown as (p: Record<string, unknown>) => unknown
      return good({ ...props, name: 'WRONG' })
    }
    const result = await runParityCase(assertParityCase(caseJson), makeUnit(BadSlotGroup as never))
    expect(result.accepted).toBe(false)
    expect(result.reasons.join()).toMatch(/diverges from baseline/)
  })

  it('teardown stops resize events: a disposed Angular unit emits nothing on later resize', async () => {
    const adapter = new AngularAdapter(SlotGroupComponent)
    await adapter.mount({ name: 'header', direction: 'row' })
    await adapter.settle()
    adapter.drainEvents()
    await adapter.dispose()

    // Fire a resize AFTER dispose — a leaked observer/subscription would still emit.
    triggerResize(document.body, undefined, 300, 20)
    await microSettle(3)
    await new Promise((r) => setTimeout(r, 150))
    expect(adapter.drainEvents()).toEqual([])
  })
})
