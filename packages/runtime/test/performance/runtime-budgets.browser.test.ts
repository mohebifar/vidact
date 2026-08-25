import { describe, expect, it } from 'vitest'

import {
  binding,
  compiledRoot,
  createCompiledScope,
  createCompiledState,
  mountCompiled,
} from '../../src/compiled/core.ts'
import { h } from '../../src/direct-dom.ts'
import { source } from '../../src/source-mask.ts'
import { readCompiledOwnerMetrics } from '../../src/testing.ts'

describe('runtime performance and retention budgets', () => {
  it('bounds mount/update time, owner allocations, and retained owners', () => {
    const baseline = readCompiledOwnerMetrics()
    const host = document.createElement('div')
    document.body.append(host)
    const countSource = source(0)
    const mountCount = 100
    const updatesPerMount = 20
    const started = performance.now()

    for (let mount = 0; mount < mountCount; mount += 1) {
      let setCount!: (value: number) => void
      const root = mountCompiled(() => {
        const scope = createCompiledScope()
        const count = createCompiledState(scope, countSource, 0)
        setCount = count.set
        return compiledRoot(scope, () => h('output', null, binding(scope, countSource, count.get)))
      }, host)
      const output = host.querySelector('output')!
      for (let update = 1; update <= updatesPerMount; update += 1) setCount(update)
      expect(host.querySelector('output')).toBe(output)
      expect(output.textContent).toBe(String(updatesPerMount))
      root.dispose()
      host.replaceChildren()
    }

    const elapsed = performance.now() - started
    const final = readCompiledOwnerMetrics()
    host.remove()

    expect(elapsed).toBeLessThan(5_000)
    expect(final.active).toBe(baseline.active)
    expect(final.created - baseline.created).toBeLessThanOrEqual(mountCount * 2)
  })
})
