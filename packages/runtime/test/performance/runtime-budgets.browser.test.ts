import { describe, expect, it } from 'vitest'

import {
  binding,
  compiledRoot,
  createCompiledScope,
  createCompiledState,
  mountCompiled,
} from '../../src/compiled/core.ts'
import { h } from '../../src/direct-dom.ts'
import { createKeyedList } from '../../src/keyed-list.ts'
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

  it('bounds large keyed-list reorder and replacement churn', () => {
    type Item = { readonly id: number; readonly label: string }
    const host = document.createElement('ul')
    document.body.append(host)
    const itemCount = 1_000
    const iterations = 20
    let created = 0
    let disposed = 0
    const initial = Array.from({ length: itemCount }, (_, id) => ({ id, label: `item ${id}` }))
    const replacement = Array.from({ length: itemCount }, (_, index) => {
      const id = itemCount + 249 - index
      return { id, label: `item ${id}` }
    })
    const list = createKeyedList<Item, number>(host, {
      key: (item) => item.id,
      render(item) {
        created += 1
        const row = document.createElement('li')
        row.dataset.key = String(item.id)
        const text = document.createTextNode(item.label)
        row.append(text)
        return [
          [row],
          (next) => {
            text.data = next.label
          },
          () => {
            disposed += 1
          },
        ]
      },
    })
    list.update(initial)
    const retained = host.querySelector('[data-key="400"]')

    const started = performance.now()
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      list.update(iteration % 2 === 0 ? replacement : initial)
    }
    const elapsed = performance.now() - started

    expect(host.querySelectorAll('li')).toHaveLength(itemCount)
    expect(host.querySelector('[data-key="400"]')).toBe(retained)
    expect(created).toBe(itemCount + iterations * 250)
    expect(disposed).toBe(iterations * 250)
    list.dispose()
    expect(disposed).toBe(created)
    expect(host.childNodes).toHaveLength(0)
    host.remove()
    expect(elapsed).toBeLessThan(5_000)
  })
})
