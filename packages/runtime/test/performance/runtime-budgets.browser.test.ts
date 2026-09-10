import { describe, expect, it } from 'vitest'

import {
  binding,
  compiledInlineEvent,
  compiledRoot,
  createCompiledScope,
  createCompiledState,
  isCompiledEventHandler,
  keyed,
  mountCompiled,
  readCompiledPublicationMetrics,
} from '../../src/compiled/core.ts'
import type { CompiledScope } from '../../src/compiled/types.ts'
import { h } from '../../src/direct-dom.ts'
import { COMPILED_DELEGATED_EVENT_INVOKE } from '../../src/dom/events.ts'
import { createKeyedList } from '../../src/keyed-list.ts'
import { source } from '../../src/source-mask.ts'
import { installStateWriteInterceptor } from '../../src/state-slot.ts'
import { readCompiledOwnerMetrics } from '../../src/testing.ts'

type KeyedItemCell = { readonly get: () => unknown }

describe('runtime performance and retention budgets', () => {
  it('does not allocate subscriptions for empty dependency masks', () => {
    const baseline = readCompiledOwnerMetrics()
    const host = document.createElement('div')
    const rowsSource = source(0)
    const itemSource = source(0)
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const rows = createCompiledState(scope, rowsSource, [{ id: 1, label: 'one' }])
      return compiledRoot(scope, () =>
        h(
          'ul',
          null,
          keyed(
            scope,
            rowsSource,
            rows.get,
            (row) => row.id,
            (row, _index, itemScope) =>
              h(
                'li',
                null,
                binding(scope, 0, () => row.get().label, itemScope, itemSource),
              ),
          ),
        ),
      )
    }, host)

    expect(readCompiledOwnerMetrics().updaters - baseline.updaters).toBe(2)

    mounted.dispose()
  })

  it('mounts scalar bindings without persistent range markers', () => {
    const host = document.createElement('div')
    const valueSource = source(0)
    let evaluations = 0
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const value = createCompiledState(scope, valueSource, 'value')
      return compiledRoot(scope, () =>
        h(
          'output',
          null,
          binding(scope, valueSource, () => {
            evaluations += 1
            return value.get()
          }),
        ),
      )
    }, host)

    expect(host.querySelector('output')?.childNodes).toHaveLength(1)
    expect(host.querySelector('output')?.firstChild).toBeInstanceOf(Text)
    expect(evaluations).toBe(1)

    mounted.dispose()
  })

  it('skips publication tree walks when no commit work is pending', () => {
    const baseline = readCompiledPublicationMetrics()
    const host = document.body.appendChild(document.createElement('div'))
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () => h('section', null, h('p', null, 'one'), h('p', null, 'two')))
    }, host)

    expect(readCompiledPublicationMetrics().visitedNodes).toBe(baseline.visitedNodes)

    mounted.dispose()
    host.remove()
  })

  it('retains one compiled owner per keyed row', () => {
    const baseline = readCompiledOwnerMetrics()
    const host = document.createElement('div')
    const rowsSource = source(0)
    const rows: readonly { id: number; label: string }[] = [
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
      { id: 3, label: 'three' },
    ]
    let replaceRows!: (value: readonly { id: number; label: string }[]) => void
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const state = createCompiledState(scope, rowsSource, rows)
      replaceRows = state.replace
      return compiledRoot(scope, () =>
        h(
          'ul',
          null,
          keyed(
            scope,
            rowsSource,
            state.get,
            (row) => row.id,
            (row, _index, itemScope) =>
              h(
                'li',
                null,
                binding(itemScope, source(0), () => row.get().label),
              ),
            false,
          ),
        ),
      )
    }, host)

    expect(readCompiledOwnerMetrics().active - baseline.active).toBeLessThanOrEqual(rows.length + 2)
    replaceRows(rows.map((row) => ({ id: row.id, label: `${row.label}!` })))
    expect(host.textContent).toBe('one!two!three!')

    mounted.dispose()
    expect(readCompiledOwnerMetrics().active).toBe(baseline.active)
  })

  it('shares compiler-keyed row callables across rows', () => {
    const host = document.createElement('div')
    const rowsSource = source(0)
    const rowScopes: CompiledScope[] = []
    const rowCells: KeyedItemCell[] = []
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const rows = createCompiledState(scope, rowsSource, [
        { id: 1, label: 'one' },
        { id: 2, label: 'two' },
      ])
      return compiledRoot(scope, () =>
        h(
          'ul',
          null,
          keyed(
            scope,
            rowsSource,
            rows.get,
            (row) => row.id,
            (row, _index, itemScope) => {
              rowScopes.push(itemScope)
              rowCells.push(row)
              return h(
                'li',
                null,
                binding(itemScope, source(0), () => row.get().label),
              )
            },
            false,
          ),
        ),
      )
    }, host)

    expect(rowScopes[0]![1]).toBe(rowScopes[1]![1])
    expect(rowScopes[0]![3]).toBe(rowScopes[1]![3])
    expect(rowCells[0]!.get).toBe(rowCells[1]!.get)

    mounted.dispose()
  })

  it('allocates read-only concurrency bookkeeping only when intercepted', () => {
    const host = document.createElement('div')
    const rowsSource = source(0)
    let rowCell!: KeyedItemCell
    let replaceRows!: (rows: { id: number; label: string }[]) => void
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const rows = createCompiledState(scope, rowsSource, [{ id: 1, label: 'one' }])
      replaceRows = rows.replace
      return compiledRoot(scope, () =>
        h(
          'ul',
          null,
          keyed(
            scope,
            rowsSource,
            rows.get,
            (row) => row.id,
            (row, _index, itemScope) => {
              rowCell = row
              return h(
                'li',
                null,
                binding(itemScope, source(0), () => row.get().label),
              )
            },
            false,
          ),
        ),
      )
    }, host)

    expect(Object.hasOwn(rowCell, 'token')).toBe(false)
    expect(Object.hasOwn(rowCell, 'revision')).toBe(false)
    installStateWriteInterceptor(() => false)
    replaceRows([{ id: 1, label: 'updated' }])
    expect(host.textContent).toBe('updated')
    expect(Object.hasOwn(rowCell, 'token')).toBe(false)
    expect(Object.hasOwn(rowCell, 'revision')).toBe(false)

    mounted.dispose()
  })

  it('retains only essential metadata on owner-scoped batched inline events', () => {
    const host = document.createElement('div')
    const countSource = source(0)
    const errors: unknown[] = []
    let evaluations = 0
    let handler!: (() => void) & {
      [COMPILED_DELEGATED_EVENT_INVOKE]: (event: Event) => void
    }
    const mounted = mountCompiled(
      () => {
        const scope = createCompiledScope()
        const count = createCompiledState(scope, countSource, 0)
        return compiledRoot(scope, () => {
          handler = compiledInlineEvent(scope, () => {
            count.set((value) => value + 1)
            count.set((value) => value + 1)
          }) as typeof handler
          const fail = compiledInlineEvent(scope, () => {
            throw new Error('inline event failed')
          })
          return h(
            'div',
            null,
            h('button', { onClick: handler }, 'increment'),
            h('button', { onClick: fail }, 'fail'),
            h(
              'output',
              null,
              binding(scope, countSource, () => {
                evaluations += 1
                return count.get()
              }),
            ),
          )
        })
      },
      host,
      { onUncaughtError: (error) => errors.push(error) },
    )

    expect(Object.getOwnPropertySymbols(handler)).toHaveLength(2)
    expect(isCompiledEventHandler(handler)).toBe(true)
    host.querySelectorAll('button')[0]!.click()
    expect(host.querySelector('output')!.textContent).toBe('2')
    expect(evaluations).toBe(2)
    host.querySelectorAll('button')[1]!.click()
    expect(errors.map((error) => (error as Error).message)).toEqual(['inline event failed'])

    mounted.dispose()
    Reflect.apply(handler[COMPILED_DELEGATED_EVENT_INVOKE], handler, [new MouseEvent('click')])
    expect(evaluations).toBe(2)
  })

  it('bounds mount/update time, owner allocations, and retained owners', () => {
    const baseline = readCompiledOwnerMetrics()
    const host = document.createElement('div')
    document.body.append(host)
    const countSource = source(0)
    const mountCount = 100
    const updatesPerMount = 20
    const started = performance.now()
    const schedulerPlansBeforeUpdates = readCompiledOwnerMetrics().schedulerPlans

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
    expect(final.schedulerPlans).toBe(schedulerPlansBeforeUpdates)
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
