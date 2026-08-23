import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { MultiComponentApp, readCounterHandle, readCounterValueRef } from './MultiComponentApp.tsx'

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

    const root = host.querySelector<HTMLElement>('[data-multi-component-app]')!
    const output = host.querySelector<HTMLOutputElement>('[data-counter-value]')!
    const text = requireSingleDirectText(output)
    const increment = host.querySelector<HTMLButtonElement>('[data-increment]')!
    const imperativeOutput = host.querySelector<HTMLOutputElement>('[data-imperative-count]')!
    const imperativeText = requireSingleDirectText(imperativeOutput)
    const imperativeIncrement = host.querySelector<HTMLButtonElement>(
      '[data-imperative-increment]',
    )!

    expect(readCounterValueRef()).toBe(output)
    expect(readCounterHandle()?.output).toBe(imperativeOutput)

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

    expect(host.querySelector('[data-imperative-count]')).toBe(imperativeOutput)
    expect(imperativeOutput.textContent).toBe('1')
    expect(() =>
      assertMutationEnvelope(
        imperativeCapture.records,
        [{ type: 'characterData', target: imperativeText }],
        'imperative handle update',
      ),
    ).not.toThrow()

    dispose()
    dispose = undefined
    expect(readCounterValueRef()).toBeNull()
    expect(readCounterHandle()).toBeNull()
  })
})
