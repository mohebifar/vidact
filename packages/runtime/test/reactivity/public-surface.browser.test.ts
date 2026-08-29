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

  it('refuses imperative handles outside compiled component construction', () => {
    expect(() => runtime.useImperativeHandle(null, () => ({ focus: () => {} }), [])).toThrow(
      /compiled component construction/i,
    )
  })

  it('refuses compiled modules built for a different runtime protocol', () => {
    expect(() => runtime.assertRuntimeProtocol('vidact-runtime-v2')).not.toThrow()
    expect(() => runtime.assertRuntimeProtocol('vidact-runtime-v0')).toThrow(
      /compiler\/runtime protocol mismatch/i,
    )
  })

  it('copies object rest properties with data-property semantics', () => {
    const symbol = Symbol('rest')
    const input = Object.create(null) as Record<PropertyKey, unknown>
    Object.defineProperty(input, '__proto__', { enumerable: true, value: 'safe' })
    Object.defineProperty(input, 'excluded', { enumerable: true, value: 'omit' })
    Object.defineProperty(input, 'hidden', { enumerable: false, value: 'omit' })
    input[symbol] = 'symbol'

    const rest = runtime.objectRest(input, ['excluded'])

    expect(Object.getPrototypeOf(rest)).toBe(Object.prototype)
    expect(Object.hasOwn(rest, '__proto__')).toBe(true)
    expect(rest['__proto__']).toBe('safe')
    expect(rest.hidden).toBeUndefined()
    expect(rest[symbol]).toBe('symbol')
  })

  it('rejects provider construction with an unbranded context', () => {
    expect(() => runtime.runWithCompiledContext({} as never, 'value', () => 'child')).toThrow(
      'runWithCompiledContext received an unknown context',
    )
  })
})
