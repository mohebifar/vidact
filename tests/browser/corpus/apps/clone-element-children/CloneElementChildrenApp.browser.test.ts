import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { CloneElementChildrenApp } from './CloneElementChildrenApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled cloneElement child replacement', () => {
  it('replaces authored children once and updates the retained child surgically', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(CloneElementChildrenApp, host).dispose

    const target = host.querySelector<HTMLElement>('[data-cloned-target]')!
    const child = host.querySelector<HTMLElement>('[data-cloned-child]')!
    const sibling = host.querySelector<HTMLElement>('[data-stable-clone-sibling]')!
    const update = host.querySelector<HTMLButtonElement>('[data-update-cloned-child]')!
    const text = requireSingleDirectText(child)

    expect(target.textContent).toBe('First')

    const capture = await captureMutations(host, () => update.click())

    expect(host.querySelector('[data-cloned-target]')).toBe(target)
    expect(host.querySelector('[data-cloned-child]')).toBe(child)
    expect(host.querySelector('[data-stable-clone-sibling]')).toBe(sibling)
    expect(child.textContent).toBe('Second')
    expect(() =>
      assertMutationEnvelope(
        capture.records,
        [{ type: 'characterData', target: text }],
        'cloneElement child replacement update',
      ),
    ).not.toThrow()
  })
})
