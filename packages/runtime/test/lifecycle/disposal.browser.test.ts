import { describe, expect, it } from 'vitest'

import { createCompiledScope, createCompiledState, source } from '../../src/index.ts'

describe('lifecycle corpus', () => {
  it('stops updater execution after a component scope is disposed', () => {
    const valueSource = source(0)
    let runs = 0
    const scope = createCompiledScope()
    scope[0](valueSource, () => runs++)
    const value = createCompiledState(scope, valueSource, 0)

    value.set(1)
    scope[3]()
    value.set(2)

    expect(runs).toBe(1)
  })
})
