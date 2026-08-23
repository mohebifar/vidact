import { describe, expect, it } from 'vitest'

import { createCompiledScope, createCompiledState, source } from '../../src/index.ts'

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
})
