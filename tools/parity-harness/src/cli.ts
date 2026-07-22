// parity-harness CLI.
//   parity run [unitId]     run every parity case (or one unit's) and gate it
//   parity validate <file>  structurally validate a ParityCase JSON
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { ensureAngularRuntime } from './dom-env.js'
import { validateParityCase } from './validate.js'
import { hashString, BaselineStore } from './baseline.js'
import { runParityCase, type ParityResult } from './runner.js'
import { evaluateGate } from './gate.js'
import { buildRegistry, unitCases, unitInventory } from './registry.js'

function sourceCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'nogit'
  }
}

function reportOne(r: ParityResult): void {
  const mark = r.accepted ? '✓' : '✗'
  console.log(`\n${mark} ${r.unitId} / ${r.caseId}`)
  console.log(`  checkpoints: ${r.checkpoints.join(', ')}`)
  console.log(`  baseline:    ${r.baseline.reused ? 'reused' : 'recorded'} (${r.baseline.key})`)
  for (const v of r.angularContract) console.log(`  [Angular contract] ${v.checkpoint}: ${v.message}`)
  for (const v of r.reactContract) console.log(`  [React contract]   ${v.checkpoint}: ${v.message}`)
  if (r.counterexample) {
    const c = r.counterexample
    console.log(`  ✗ counterexample @ ${c.checkpoint} · ${c.channel}/${c.path}`)
    console.log(`      Angular: ${JSON.stringify(c.baseline)}`)
    console.log(`      React:   ${JSON.stringify(c.candidate)}`)
  }
  if (!r.accepted && !r.counterexample && r.reasons.length) console.log(`  reasons: ${r.reasons.join('; ')}`)
}

async function cmdRun(unitFilter?: string): Promise<number> {
  await ensureAngularRuntime()
  const registry = await buildRegistry()
  const store = new BaselineStore(join(process.cwd(), 'baselines'))
  const commit = sourceCommit()
  let failed = 0

  for (const entry of Object.values(registry)) {
    if (unitFilter && entry.unitId !== unitFilter) continue
    const cases = unitCases(entry)
    const results: ParityResult[] = []
    for (const pcase of cases) {
      const { angular, react } = entry.makeAdapters()
      const result = await runParityCase(pcase, {
        angular,
        react,
        styleProbes: entry.styleProbes,
        keyParts: {
          sourceCommit: commit,
          componentHash: hashString(entry.unitId),
          caseHash: hashString(JSON.stringify(pcase)),
          fixtureHash: pcase.fixtureProfile ?? 'none',
        },
      }, store)
      results.push(result)
      reportOne(result)
      if (!result.accepted) failed++
    }

    // Unit acceptance gate (residue/typecheck/mount are supplied by other stages;
    // here we assert I/O-inventory coverage + all-cases-accepted).
    const gate = evaluateGate({
      inventory: unitInventory(entry),
      cases,
      allCasesAccepted: results.every((r) => r.accepted),
      residueClear: true,
      typechecks: true,
      mounts: true,
    })
    const gmark = gate.accepted ? '✓' : '✗'
    console.log(`\n${gmark} GATE ${entry.unitId}: ${gate.accepted ? 'accepted' : gate.reasons.join('; ')}`)
    if (!gate.accepted) failed++
  }
  return failed === 0 ? 0 : 1
}

function cmdValidate(file: string): number {
  const value = JSON.parse(readFileSync(file, 'utf8'))
  const { ok, errors } = validateParityCase(value)
  if (ok) {
    console.log(`✓ valid ParityCase: ${file}`)
    return 0
  }
  console.log(`✗ invalid ParityCase: ${file}`)
  for (const e of errors) console.log(`  ${e}`)
  return 1
}

const [cmd, arg] = process.argv.slice(2)
const run =
  cmd === 'validate' && arg
    ? Promise.resolve(cmdValidate(arg))
    : cmd === 'run' || cmd === undefined
      ? cmdRun(arg)
      : Promise.resolve(
          (console.log('usage: parity run [unitId] | parity validate <caseFile>'), 1) as number,
        )

run.then((code) => process.exit(code))
