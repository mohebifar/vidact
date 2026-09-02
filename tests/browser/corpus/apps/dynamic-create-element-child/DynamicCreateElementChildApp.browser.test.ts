import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { DynamicCreateElementChildApp } from './DynamicCreateElementChildApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled dynamic createElement child', () => {
  it('constructs one guarded intrinsic and updates its retained child surgically', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(DynamicCreateElementChildApp, host).dispose

    const target = host.querySelector<HTMLElement>('[data-dynamic-target]')!
    const child = host.querySelector<HTMLElement>('[data-dynamic-child]')!
    const sibling = host.querySelector<HTMLElement>('[data-stable-dynamic-sibling]')!
    const update = host.querySelector<HTMLButtonElement>('[data-update-dynamic-child]')!
    const text = requireSingleDirectText(child)

    expect(target.localName).toBe('section')
    expect(target.dataset.dynamicLabel).toBe('First')

    const capture = await captureMutations(host, () => update.click())

    expect(host.querySelector('[data-dynamic-target]')).toBe(target)
    expect(host.querySelector('[data-dynamic-child]')).toBe(child)
    expect(host.querySelector('[data-stable-dynamic-sibling]')).toBe(sibling)
    expect(target.dataset.dynamicLabel).toBe('Second')
    expect(child.textContent).toBe('Second')
    expect(() =>
      assertMutationEnvelope(
        capture.records,
        [
          { type: 'attributes', target, attributeName: 'data-dynamic-label' },
          { type: 'characterData', target: text },
        ],
        'dynamic createElement child update',
      ),
    ).not.toThrow()
  })
})
