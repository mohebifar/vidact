import { describe, expect, it } from 'vitest'

import {
  compiledInsertionEffect,
  compiledRoot,
  createCompiledScope,
  createCompiledState,
  h,
  mountCompiled,
  source,
} from '../../src/index.ts'
import type { StateSlot } from '../../src/state-slot.ts'

describe('lifecycle corpus', () => {
  it('rejects retained state setters after a component scope is disposed', () => {
    const valueSource = source(0)
    let runs = 0
    const scope = createCompiledScope()
    scope[0](valueSource, () => runs++)
    const value = createCompiledState(scope, valueSource, 0)

    value.set(1)
    scope[3]()
    let functionalUpdateRan = false

    expect(runs).toBe(1)
    expect(() => value.set(2)).toThrow('cannot update state after disposal')
    expect(() =>
      value.set(() => {
        functionalUpdateRan = true
        return 3
      }),
    ).toThrow('cannot update state after disposal')
    expect(functionalUpdateRan).toBe(false)
    expect(value.get()).toBe(1)
  })

  it('allows cleanup callbacks to retire state during a disposal cascade', () => {
    const host = document.createElement('div')
    let value!: StateSlot<number>
    const disposedScope = createCompiledScope()
    const disposedValue = createCompiledState(disposedScope, source(2), 0)
    disposedScope[3]()
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      value = createCompiledState(scope, source(0), 0)
      compiledInsertionEffect(scope, source(1), () => () => () => {
        value.set(1)
        expect(() => disposedValue.set(1)).toThrow('cannot update state after disposal')
      })
      return compiledRoot(scope, () => h('span', null, 'ready'))
    }, host)

    expect(() => mounted.dispose()).not.toThrow()
    expect(value.get()).toBe(1)
    expect(() => value.set(2)).toThrow('cannot update state after disposal')
  })
})
