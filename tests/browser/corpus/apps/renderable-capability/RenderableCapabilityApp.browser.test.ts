import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import {
  RenderableCapabilityApp,
  renderableRefTrace,
  resetRenderableRefTrace,
} from './RenderableCapabilityApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled renderable capability app', () => {
  it('reruns the package merge and updates one retained node surgically', async () => {
    resetRenderableRefTrace()
    const host = document.createElement('div')
    document.body.append(host)
    const mounted = mountCompiled(RenderableCapabilityApp, host)
    dispose = mounted.dispose

    const link = host.querySelector<HTMLAnchorElement>('[data-renderable-link]')!
    const toggle = host.querySelector<HTMLButtonElement>('[data-toggle-renderable]')!
    const text = requireSingleDirectText(link)

    expect(link.href).toContain('/first')
    expect(link.className).toBe('base authored')
    expect(link.style.color).toBe('red')
    expect(link.style.opacity).toBe('1')
    expect(renderableRefTrace()).toEqual([0, 1, 0])
    link.click()
    expect(host.querySelector('[data-renderable-trace]')?.textContent).toBe('authored-base')

    const capture = await captureMutations(host, () => toggle.click())

    expect(host.querySelector('[data-renderable-link]')).toBe(link)
    expect(link.href).toContain('/second')
    expect(link.dataset.disabled).toBe('true')
    expect(link.style.opacity).toBe('0.5')
    expect(link.textContent).toBe('Disabled')
    expect(() =>
      assertMutationEnvelope(
        capture.records,
        [
          { type: 'attributes', target: link, attributeName: 'href' },
          { type: 'attributes', target: link, attributeName: 'data-disabled' },
          { type: 'attributes', target: link, attributeName: 'style' },
          { type: 'characterData', target: text },
        ],
        'renderable capability update',
      ),
    ).not.toThrow()
    expect(renderableRefTrace()).toEqual([0, 1, 0])

    mounted.dispose()
    dispose = undefined
    expect(renderableRefTrace()).toEqual([0, 1, 1])
  })
})
