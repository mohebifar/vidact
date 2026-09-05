import { mountCompiled } from '@vidact/runtime'
import { readCompiledOwnerMetrics } from '@vidact/runtime/testing'
import { act, assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { BaseUiDependencyApp } from './BaseUiDependencyApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled Base UI dependency app', () => {
  it('runs published merge logic while retaining the dependency-owned nodes', async () => {
    const baseline = readCompiledOwnerMetrics()
    const host = document.createElement('div')
    document.body.append(host)
    const mounted = mountCompiled(BaseUiDependencyApp, host)
    dispose = mounted.dispose

    const button = host.querySelector<HTMLButtonElement>('[data-base-counter]')!
    const link = host.querySelector<HTMLAnchorElement>('[data-base-link]')!
    const text = [...button.childNodes].findLast((node): node is Text => node instanceof Text)!

    expect(button.type).toBe('button')
    expect(button.className).toBe('counter')
    expect(link.getAttribute('role')).toBe('button')
    expect(link.textContent).toBe('Details')

    const updated = await captureMutations(host, () => button.click())

    expect(host.querySelector('[data-base-counter]')).toBe(button)
    expect(host.querySelector('[data-base-link]')).toBe(link)
    expect(button.className).toBe('counter')
    expect(button.textContent).toBe('Count 1')
    expect(() =>
      assertMutationEnvelope(
        updated.records,
        [{ type: 'characterData', target: text }],
        'Base UI counter update',
      ),
    ).not.toThrow()

    mounted.dispose()
    dispose = undefined
    expect(readCompiledOwnerMetrics().active).toBe(baseline.active)
  })

  it('runs published Switch and Accordion interactions without remounting their owners', async () => {
    const baseline = readCompiledOwnerMetrics()
    const host = document.createElement('div')
    document.body.append(host)
    const mounted = mountCompiled(BaseUiDependencyApp, host)
    dispose = mounted.dispose

    const controls = host.querySelector<HTMLElement>('[data-base-controls]')!
    const switchRoot = host.querySelector<HTMLElement>('[data-base-switch]')!
    const switchThumb = host.querySelector<HTMLElement>('[data-base-switch-thumb]')!
    const accordion = host.querySelector<HTMLElement>('[data-base-accordion]')!
    const accordionItem = host.querySelector<HTMLElement>('[data-base-accordion-item]')!
    const accordionTrigger = host.querySelector<HTMLButtonElement>('[data-base-accordion-trigger]')!
    const accordionPanel = host.querySelector<HTMLElement>('[data-base-accordion-panel]')!

    expect(switchRoot.getAttribute('aria-checked')).toBe('true')
    expect(accordionTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(accordionPanel.hasAttribute('data-open')).toBe(true)

    const switchUpdate = await captureMutations(controls, () => switchRoot.click())

    expect(host.querySelector('[data-base-switch]')).toBe(switchRoot)
    expect(host.querySelector('[data-base-switch-thumb]')).toBe(switchThumb)
    expect(switchRoot.getAttribute('aria-checked')).toBe('false')
    expect(() =>
      assertMutationEnvelope(
        switchUpdate.records,
        [{ type: 'attributes', within: switchRoot }],
        'Base UI switch update',
      ),
    ).not.toThrow()

    const accordionUpdate = await captureMutations(controls, () =>
      act(() => accordionTrigger.click()),
    )

    expect(host.querySelector('[data-base-accordion]')).toBe(accordion)
    expect(host.querySelector('[data-base-accordion-item]')).toBe(accordionItem)
    expect(host.querySelector('[data-base-accordion-trigger]')).toBe(accordionTrigger)
    expect(host.querySelector('[data-base-accordion-panel]')).toBe(accordionPanel)
    expect(accordionTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(accordionPanel.hasAttribute('data-closed')).toBe(true)
    expect(() =>
      assertMutationEnvelope(
        accordionUpdate.records,
        [{ type: 'attributes', within: accordion }],
        'Base UI accordion update',
      ),
    ).not.toThrow()

    mounted.dispose()
    dispose = undefined
    expect(readCompiledOwnerMetrics().active).toBe(baseline.active)
  })
})
