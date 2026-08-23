import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { WideSourceMaskApp } from './WideSourceMaskApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled wide source masks', () => {
  it('updates source 32 in place through the wide-mask fallback', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(WideSourceMaskApp, host).dispose

    const root = host.querySelector<HTMLElement>('section')!
    const button = host.querySelector<HTMLButtonElement>('[data-increment-wide]')!
    const output = host.querySelector<HTMLOutputElement>('[data-wide-value]')!
    const text = requireSingleDirectText(output)

    expect(root.dataset.narrowTotal).toBe('496')
    expect(output.textContent).toBe('32')

    const capture = await captureMutations(host, () => button.click())

    expect(host.querySelector('section')).toBe(root)
    expect(host.querySelector('[data-increment-wide]')).toBe(button)
    expect(host.querySelector('[data-wide-value]')).toBe(output)
    expect(root.dataset.narrowTotal).toBe('496')
    expect(output.textContent).toBe('33')
    expect(capture.records).toHaveLength(1)
    expect(() =>
      assertMutationEnvelope(
        capture.records,
        [{ type: 'characterData', target: text }],
        'wide source update',
      ),
    ).not.toThrow()
  })
})
