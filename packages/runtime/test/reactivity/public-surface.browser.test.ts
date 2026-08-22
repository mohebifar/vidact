import * as runtime from '@vidact/runtime'
import { describe, expect, it } from 'vitest'

describe('runtime public surface', () => {
  it('does not expose the legacy component replay runtime', () => {
    expect('mount' in runtime).toBe(false)
    expect('useState' in runtime).toBe(false)
    expect('createUpdaterScope' in runtime).toBe(false)
    expect('createStateSlot' in runtime).toBe(false)
    expect('createKeyedList' in runtime).toBe(false)
    expect('createIndexedList' in runtime).toBe(false)
  })

  it('keeps one-shot refs available to compiled components', () => {
    const ref = runtime.useRef('initial')

    expect(ref).toEqual({ current: 'initial' })
  })
})
