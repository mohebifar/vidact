import { describe, expect, it } from 'vitest'
import { createStateSlot, createUpdaterScope, source } from '@vidact/runtime'

describe('lifecycle corpus', () => {
  it('stops updater execution after a component scope is disposed', () => {
    const valueSource = source(0)
    let runs = 0
    const scope = createUpdaterScope([
      { reads: valueSource, run: () => runs++ },
    ])
    const value = createStateSlot(scope, valueSource, 0)

    value.set(1)
    scope.dispose()
    value.set(2)

    expect(runs).toBe(1)
  })
})
