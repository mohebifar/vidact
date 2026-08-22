import { describe, expect, it } from 'vitest'

import { combineSources, createStateSlot, createUpdaterScope, source } from '../../src/index.ts'

describe('static updater corpus', () => {
  it('propagates state through compiler-ordered updaters without subscriptions', () => {
    const countSource = source(0)
    const doubledSource = source(1)
    const text = document.createTextNode('0')
    const trace: string[] = []
    let count!: ReturnType<typeof createStateSlot<number>>
    let doubled = 0

    const scope = createUpdaterScope([
      {
        reads: countSource,
        writes: doubledSource,
        run: () => {
          doubled = count.get() * 2
          trace.push('derive')
        },
      },
      {
        reads: doubledSource,
        run: () => {
          text.data = String(doubled)
          trace.push('text')
        },
      },
    ])
    count = createStateSlot(scope, countSource, 0)

    count.set(3)

    expect(text.data).toBe('6')
    expect(trace).toEqual(['derive', 'text'])
  })

  it('batches multiple source writes into one updater execution', () => {
    const firstSource = source(0)
    const lastSource = source(1)
    let first!: ReturnType<typeof createStateSlot<string>>
    let last!: ReturnType<typeof createStateSlot<string>>
    let runs = 0
    let fullName = ''
    const scope = createUpdaterScope([
      {
        reads: combineSources(firstSource, lastSource),
        run: () => {
          runs += 1
          fullName = `${first.get()} ${last.get()}`
        },
      },
    ])
    first = createStateSlot(scope, firstSource, 'Ada')
    last = createStateSlot(scope, lastSource, 'Lovelace')

    scope.batch(() => {
      first.set('Grace')
      last.set('Hopper')
    })

    expect(fullName).toBe('Grace Hopper')
    expect(runs).toBe(1)
  })

  it('supports components with more than 32 reactive sources', () => {
    const wideSource = source(65)
    let value!: ReturnType<typeof createStateSlot<number>>
    let observed = 0
    const scope = createUpdaterScope([
      {
        reads: wideSource,
        run: () => {
          observed = value.get()
        },
      },
    ])
    value = createStateSlot(scope, wideSource, 0)

    value.set(42)

    expect(observed).toBe(42)
  })

  it('keeps source bits distinct at every 32-bit word boundary', () => {
    const indexes = [31, 32, 63, 64]
    const masks = indexes.map(source)
    const observed: number[] = []
    const scope = createUpdaterScope(
      masks.map((reads, index) => ({
        reads,
        run: () => observed.push(indexes[index]!),
      })),
    )

    scope.invalidate(combineSources(masks[1]!, masks[3]!))

    expect(observed).toEqual([32, 64])
  })

  it('fails loudly when updater-triggered writes cannot stabilize', () => {
    const valueSource = source(0)
    let value!: ReturnType<typeof createStateSlot<number>>
    const scope = createUpdaterScope([
      {
        reads: valueSource,
        run: () => value.set((previous) => previous + 1),
      },
    ])
    value = createStateSlot(scope, valueSource, 0)

    expect(() => value.set(1)).toThrow(/stabilize/i)
  })
})
