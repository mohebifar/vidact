import { describe, expect, it } from 'vitest'

import {
  binding,
  combineSources,
  createCompiledRestProp,
  createCompiledMemo,
  createCompiledReducer,
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

    scope[0](
      countSource,
      () => {
        doubled = count.get() * 2
        trace.push('derive')
      },
      doubledSource,
    )
    scope[0](doubledSource, () => {
      text.data = String(doubled)
      trace.push('text')
    })

    count.set(3)

    expect(text.data).toBe('6')
    expect(trace).toEqual(['derive', 'text'])
  })

  it('orders generated prerequisites before earlier registered consumers', () => {
    const inputSource = source(0)
    const derivedSource = source(1)
    const outputSource = source(2)
    const scope = createCompiledScope()
    const input = createCompiledState(scope, inputSource, 1)
    let derived = input.get()
    let output = derived
    const trace: string[] = []

    scope[0](
      derivedSource,
      () => {
        output = derived
        trace.push('consumer')
      },
      outputSource,
    )
    scope[0](
      inputSource,
      () => {
        derived = input.get() * 2
        trace.push('prerequisite')
      },
      derivedSource,
    )

    input.set(3)

    expect(output).toBe(6)
    expect(trace).toEqual(['prerequisite', 'consumer'])
  })

  it('keeps downstream prerequisites ordered after a reactive dependency cycle', () => {
    const inputSource = source(0)
    const cycleLeftSource = source(1)
    const cycleRightSource = source(2)
    const derivedSource = source(3)
    const scope = createCompiledScope()
    const input = createCompiledState(scope, inputSource, 1)
    let cycleLeft = 0
    let cycleRight = 0
    let derived = 0
    let output = 0
    const trace: string[] = []

    scope[0](derivedSource, () => {
      output = derived
      trace.push('consumer')
    })
    scope[0](
      combineSources(inputSource, cycleRightSource),
      () => {
        cycleLeft = input.get()
        trace.push('cycle-left')
      },
      cycleLeftSource,
    )
    scope[0](
      cycleLeftSource,
      () => {
        cycleRight = cycleLeft
        trace.push('cycle-right')
      },
      cycleRightSource,
    )
    scope[0](
      cycleLeftSource,
      () => {
        derived = cycleRight * 2
        trace.push('derive')
      },
      derivedSource,
    )

    input.set(3)

    expect(output).toBe(6)
    expect(trace).toEqual(['cycle-left', 'cycle-right', 'derive', 'consumer'])
  })

  it('recomputes updater order after registrations change', () => {
    const inputSource = source(0)
    const derivedSource = source(1)
    const scope = createCompiledScope()
    const input = createCompiledState(scope, inputSource, 1)
    let derived = input.get()
    let output = derived

    const removeConsumer = scope[0](derivedSource, () => {
      output = derived
    })
    const removePrerequisite = scope[0](
      inputSource,
      () => {
        derived = input.get() * 2
      },
      derivedSource,
    )
    input.set(2)
    expect(output).toBe(4)

    removeConsumer()
    removePrerequisite()
    scope[0](derivedSource, () => {
      output = derived
    })
    scope[0](
      inputSource,
      () => {
        derived = input.get() * 3
      },
      derivedSource,
    )

    input.set(3)

    expect(output).toBe(9)
  })

  it('batches multiple source writes into one updater execution', () => {
    const firstSource = source(0)
    const lastSource = source(1)
    const scope = createCompiledScope()
    const first = createCompiledState(scope, firstSource, 'Ada')
    const last = createCompiledState(scope, lastSource, 'Lovelace')
    let runs = 0
    let fullName = ''
    scope[0](combineSources(firstSource, lastSource), () => {
      runs += 1
      fullName = `${first.get()} ${last.get()}`
    })

    scope[2](() => {
      first.set('Grace')
      last.set('Hopper')
    })

    expect(fullName).toBe('Grace Hopper')
    expect(runs).toBe(1)
  })

  it('reduces actions through the shared state-slot primitive', () => {
    type Action = number | (() => number)
    const valueSource = source(0)
    const scope = createCompiledScope()
    let initializations = 0
    const value = createCompiledReducer(
      scope,
      valueSource,
      (current: number, action: Action) =>
        current + (typeof action === 'number' ? action : action()),
      '2',
      (initial) => {
        initializations += 1
        return Number(initial)
      },
    )
    let observed = value.get()
    scope[0](valueSource, () => {
      observed = value.get()
    })

    const functionAction = () => 3
    value.set(functionAction)

    expect(initializations).toBe(1)
    expect(observed).toBe(5)
    scope[3]()
    expect(() => value.set(1)).toThrow('cannot update state after disposal')
  })

  it('replaces internal function values without invoking them as state updaters', () => {
    const callbackSource = source(0)
    const scope = createCompiledScope()
    const first = () => 'first'
    const second = () => 'second'
    const callback = createCompiledState(scope, callbackSource, () => first)

    callback.replace(second)

    expect(callback.get()).toBe(second)
    expect(callback.get()()).toBe('second')
  })

  it('does not publish an unchanged projection of reactive rest props', () => {
    const inputSource = source(0)
    const restSource = source(1)
    const scope = createCompiledScope()
    const input = createCompiledState(scope, inputSource, { label: 'same', version: 0 })
    const rest = createCompiledRestProp(
      scope,
      restSource,
      { 'aria-label': binding(scope, inputSource, () => input.get().label) },
      [],
    )
    const initial = rest.get()
    let publications = 0
    scope[0](restSource, () => {
      publications += 1
    })

    input.set({ label: 'same', version: 1 })
    expect(rest.get()).toBe(initial)
    expect(publications).toBe(0)

    input.set({ label: 'changed', version: 2 })
    expect(rest.get()).toEqual({ 'aria-label': 'changed' })
    expect(publications).toBe(1)
  })

  it('publishes cached values only when memo dependencies change', () => {
    const countSource = source(0)
    const memoSource = source(1)
    const unrelatedSource = source(2)
    const scope = createCompiledScope()
    const count = createCompiledState(scope, countSource, 0)
    const unrelated = createCompiledState(scope, unrelatedSource, 0)
    let evaluations = 0
    const memo = createCompiledMemo(
      scope,
      countSource,
      memoSource,
      () => ({ count: count.get(), evaluation: ++evaluations }),
      () => [count.get() % 2],
    )
    const initial = memo.get()
    const observed: object[] = []
    scope[0](memoSource, () => observed.push(memo.get()))

    unrelated.set(1)
    count.set(2)

    expect(memo.get()).toBe(initial)
    expect(evaluations).toBe(1)
    expect(observed).toEqual([])

    count.set(3)

    expect(memo.get()).not.toBe(initial)
    expect(memo.get()).toEqual({ count: 3, evaluation: 2 })
    expect(observed).toEqual([memo.get()])
  })

  it('keeps source bits distinct at every 32-bit word boundary', () => {
    const indexes = [31, 32, 63, 64]
    const masks = indexes.map(source)
    const observed: number[] = []
    const scope = createCompiledScope()
    masks.forEach((reads, index) => {
      scope[0](reads, () => observed.push(indexes[index]!))
    })

    scope[1](combineSources(masks[1]!, masks[3]!))

    expect(observed).toEqual([32, 64])
  })

  it('fails loudly when updater-triggered writes cannot stabilize', () => {
    const valueSource = source(0)
    const scope = createCompiledScope()
    const value = createCompiledState(scope, valueSource, 0)
    scope[0](valueSource, () => value.set((previous) => previous + 1))

    expect(() => value.set(1)).toThrow(/did not stabilize/i)
  })
})
