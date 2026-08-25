import { describe, expect, it } from 'vitest'

import {
  createCompiledDeferred,
  createCompiledTransition,
  flushSync,
  startTransition,
} from '../../src/concurrent.ts'
import {
  createCompiledScope,
  createCompiledState,
  combineSources,
  source,
} from '../../src/index.ts'
import { flushScheduledTasks } from '../../src/testing.ts'

describe('concurrent scheduling', () => {
  it('defers and atomically publishes a transition batch', () => {
    const firstSource = source(0)
    const secondSource = source(1)
    const pendingSource = source(2)
    const scope = createCompiledScope()
    const first = createCompiledState(scope, firstSource, 0)
    const second = createCompiledState(scope, secondSource, 0)
    const transition = createCompiledTransition(scope, pendingSource)
    const observed: Array<readonly [number, number]> = []
    scope[0](combineSources(firstSource, secondSource), () => {
      observed.push([first.get(), second.get()])
    })

    transition.set(() => {
      first.set(1)
      first.set((value) => value + 1)
      second.set(3)
    })

    expect(transition.get()).toBe(true)
    expect([first.get(), second.get()]).toEqual([0, 0])
    flushScheduledTasks()

    expect(transition.get()).toBe(false)
    expect([first.get(), second.get()]).toEqual([2, 3])
    expect(observed).toEqual([[2, 3]])
  })

  it('cancels stale deferred writes after an urgent write to the same slot', () => {
    const valueSource = source(0)
    const scope = createCompiledScope()
    const value = createCompiledState(scope, valueSource, 'initial')

    startTransition(() => value.set('stale'))
    value.set('urgent')
    flushScheduledTasks()

    expect(value.get()).toBe('urgent')
  })

  it('lets the newest transition on a lane supersede older work', () => {
    const valueSource = source(0)
    const pendingSource = source(1)
    const scope = createCompiledScope()
    const value = createCompiledState(scope, valueSource, 0)
    const transition = createCompiledTransition(scope, pendingSource)

    transition.set(() => value.set(1))
    transition.set(() => value.set(2))
    flushScheduledTasks()

    expect(value.get()).toBe(2)
    expect(transition.get()).toBe(false)
  })

  it('publishes only the latest deferred value', () => {
    const inputSource = source(0)
    const deferredSource = source(1)
    const scope = createCompiledScope()
    const input = createCompiledState(scope, inputSource, 'a')
    const deferred = createCompiledDeferred(scope, inputSource, deferredSource, () => input.get())

    input.set('b')
    input.set('c')
    expect(deferred.get()).toBe('a')
    flushScheduledTasks()

    expect(deferred.get()).toBe('c')
  })

  it('flushes queued transition work synchronously when requested', () => {
    const valueSource = source(0)
    const scope = createCompiledScope()
    const value = createCompiledState(scope, valueSource, 0)
    startTransition(() => value.set(1))

    expect(value.get()).toBe(0)
    const result = flushSync(() => 'done')

    expect(result).toBe('done')
    expect(value.get()).toBe(1)
  })

  it('keeps pending state until an asynchronous transition action settles', async () => {
    const valueSource = source(0)
    const pendingSource = source(1)
    const scope = createCompiledScope()
    const value = createCompiledState(scope, valueSource, 0)
    const transition = createCompiledTransition(scope, pendingSource)
    let resolve!: () => void
    const waiting = new Promise<void>((settle) => {
      resolve = settle
    })

    transition.set(async () => {
      value.set(1)
      await waiting
    })
    flushScheduledTasks()
    expect(value.get()).toBe(1)
    expect(transition.get()).toBe(true)

    resolve()
    await waiting
    await Promise.resolve()
    expect(transition.get()).toBe(false)
  })
})
