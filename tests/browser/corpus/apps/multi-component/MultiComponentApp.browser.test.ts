import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MultiComponentApp,
  readCounterHandle,
  readCounterValueRef,
  readSecondaryCounterHandle,
  takeEffectTrace,
} from './MultiComponentApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled same-module components', () => {
  it('updates the child binding without remounting either component', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(MultiComponentApp, host).dispose
    await Promise.resolve()

    const root = host.querySelector<HTMLElement>('[data-multi-component-app]')!
    const output = host.querySelector<HTMLOutputElement>('[data-counter-value]')!
    const text = requireSingleDirectText(output)
    const increment = host.querySelector<HTMLButtonElement>('[data-increment]')!
    const imperativeOutput = host.querySelector<HTMLOutputElement>('[data-imperative-count]')!
    const imperativeText = requireSingleDirectText(imperativeOutput)
    const imperativeIncrement = host.querySelector<HTMLButtonElement>(
      '[data-imperative-increment]',
    )!
    const switchHandleRef = host.querySelector<HTMLButtonElement>('[data-switch-handle-ref]')!

    expect(readCounterValueRef()).toBe(output)
    const initialHandle = readCounterHandle()
    expect(initialHandle?.count).toBe(0)
    expect(initialHandle?.output).toBe(imperativeOutput)
    expect(initialHandle?.textAtCreation).toBe('0')
    expect(takeEffectTrace()).toEqual(['layout:0:0', 'passive:0:0'])

    const capture = await captureMutations(host, () => increment.click())

    expect(host.querySelector('[data-multi-component-app]')).toBe(root)
    expect(host.querySelector('[data-counter-value]')).toBe(output)
    expect(output.textContent).toBe('1')
    expect(capture.records).toHaveLength(1)
    expect(() =>
      assertMutationEnvelope(
        capture.records,
        [{ type: 'characterData', target: text }],
        'same-module child prop update',
      ),
    ).not.toThrow()

    const imperativeCapture = await captureMutations(host, () => imperativeIncrement.click())
    await Promise.resolve()

    expect(host.querySelector('[data-imperative-count]')).toBe(imperativeOutput)
    expect(imperativeOutput.textContent).toBe('1')
    expect(readCounterHandle()?.count).toBe(1)
    expect(readCounterHandle()).not.toBe(initialHandle)
    expect(readCounterHandle()?.textAtCreation).toBe('1')
    expect(takeEffectTrace()).toEqual([
      'layout-cleanup:0',
      'layout:1:1',
      'passive-cleanup:0',
      'passive:1:1',
    ])
    expect(() =>
      assertMutationEnvelope(
        imperativeCapture.records,
        [{ type: 'characterData', target: imperativeText }],
        'imperative handle update',
      ),
    ).not.toThrow()

    const refCapture = await captureMutations(host, () => switchHandleRef.click())

    expect(refCapture.records).toHaveLength(0)
    expect(readCounterHandle()).toBeNull()
    expect(readSecondaryCounterHandle()?.count).toBe(1)
    expect(readSecondaryCounterHandle()?.output).toBe(imperativeOutput)

    dispose()
    dispose = undefined
    expect(readCounterValueRef()).toBeNull()
    expect(readCounterHandle()).toBeNull()
    expect(readSecondaryCounterHandle()).toBeNull()
    expect(takeEffectTrace()).toEqual(['layout-cleanup:1'])
    await Promise.resolve()
    expect(takeEffectTrace()).toEqual(['passive-cleanup:1'])
  })
})
