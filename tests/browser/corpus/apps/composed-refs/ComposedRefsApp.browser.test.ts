import { mountCompiled } from '@vidact/runtime'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import ComposedRefsApp, { readComposedRefTrace, resetComposedRefTrace } from './ComposedRefsApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  resetComposedRefTrace()
  document.body.replaceChildren()
})

describe('compiled custom-hook rest parameters', () => {
  it('composes changing refs without replacing or mutating the retained node', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(ComposedRefsApp, host).dispose

    const input = host.querySelector<HTMLInputElement>('[data-composed-ref]')!
    const switchRef = host.querySelector<HTMLButtonElement>('[data-switch-ref]')!

    expect(readComposedRefTrace()).toEqual(['primary:attach', 'authored:attach'])

    const switched = await captureMutations(host, () => switchRef.click())

    expect(host.querySelector('[data-composed-ref]')).toBe(input)
    expect(input.value).toBe('retained')
    expect(readComposedRefTrace()).toEqual([
      'primary:attach',
      'authored:attach',
      'primary:detach',
      'authored:detach',
      'secondary:attach',
      'authored:attach',
    ])
    expect(() =>
      assertMutationEnvelope(switched.records, [], 'composed ref identity switch'),
    ).not.toThrow()

    dispose()
    dispose = undefined
    expect(readComposedRefTrace().slice(-2)).toEqual(['secondary:detach', 'authored:detach'])
  })
})
