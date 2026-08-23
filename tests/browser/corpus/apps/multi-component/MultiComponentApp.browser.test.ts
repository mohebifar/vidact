import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { MultiComponentApp, readCounterValueRef } from './MultiComponentApp.tsx'

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

    expect(readCounterValueRef()).toBe(output)

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

    dispose()
    dispose = undefined
    expect(readCounterValueRef()).toBeNull()
  })
})
