import { describe, expect, it } from 'vitest'

import {
  combineSources,
  createCompiledScope,
  createCompiledState,
  source,
} from '../../src/index.ts'

describe('compiled updater corpus', () => {
  it('propagates state through compiler-ordered updaters without subscriptions', () => {
    const countSource = source(0)
    const doubledSource = source(1)
    const text = document.createTextNode('0')
    const trace: string[] = []
    const scope = createCompiledScope()
    const count = createCompiledState(scope, countSource, 0)
    let doubled = 0

    scope.add({
      reads: countSource,
      writes: doubledSource,
      run: () => {
        doubled = count.get() * 2
        trace.push('derive')
      },
    })
    scope.add({
      reads: doubledSource,
      run: () => {
        text.data = String(doubled)
        trace.push('text')
      },
    })

    count.set(3)

    expect(text.data).toBe('6')
    expect(trace).toEqual(['derive', 'text'])
  })

  it('batches multiple source writes into one updater execution', () => {
    const firstSource = source(0)
    const lastSource = source(1)
    const scope = createCompiledScope()
    const first = createCompiledState(scope, firstSource, 'Ada')
    const last = createCompiledState(scope, lastSource, 'Lovelace')
    let runs = 0
    let fullName = ''
    scope.add({
      reads: combineSources(firstSource, lastSource),
      run: () => {
        runs += 1
        fullName = `${first.get()} ${last.get()}`
      },
    })

    scope.batch(() => {
      first.set('Grace')
      last.set('Hopper')
    })

    expect(fullName).toBe('Grace Hopper')
    expect(runs).toBe(1)
  })

  it('supports components with more than 32 reactive sources', () => {
    const wideSource = source(65)
    const scope = createCompiledScope()
    const value = createCompiledState(scope, wideSource, 0)
    let observed = 0
    scope.add({
      reads: wideSource,
      run: () => {
        observed = value.get()
      },
    })

    value.set(42)

    expect(observed).toBe(42)
  })

  it('keeps source bits distinct at every 32-bit word boundary', () => {
    const indexes = [31, 32, 63, 64]
    const masks = indexes.map(source)
    const observed: number[] = []
    const scope = createCompiledScope()
    masks.forEach((reads, index) => {
      scope.add({
        reads,
        run: () => observed.push(indexes[index]!),
      })
    })

    scope.invalidate(combineSources(masks[1]!, masks[3]!))

    expect(observed).toEqual([32, 64])
  })

  it('fails loudly when updater-triggered writes cannot stabilize', () => {
    const valueSource = source(0)
    const scope = createCompiledScope()
    const value = createCompiledState(scope, valueSource, 0)
    scope.add({
      reads: valueSource,
      run: () => value.set((previous) => previous + 1),
    })

    expect(() => value.set(1)).toThrow(/did not stabilize/i)
  })
})
