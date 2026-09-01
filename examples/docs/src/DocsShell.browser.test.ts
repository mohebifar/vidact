import { mountCompiled, type CompiledComponentResult } from '@vidact/runtime'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { ButtonProof, DocsLayoutProof, DocsPageProof, SwitchProof } from './DocsShellProof.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  document.documentElement.classList.remove('dark')
})

describe('Vidact-native documentation controls', () => {
  it('forwards button actions without a compatibility primitive', async () => {
    const host = await mount(ButtonProof)
    const button = host.querySelector<HTMLButtonElement>('button')!

    await captureMutations(host, () => button.click())

    expect(button.textContent).toBe('Pressed')
    expect(host.querySelector('button')).toBe(button)
  })

  it('moves the switch state without replacing its owner or thumb', async () => {
    const host = await mount(SwitchProof)
    const control = host.querySelector<HTMLButtonElement>('[role="switch"]')!
    const thumb = control.querySelector<HTMLElement>('[data-slot="switch-thumb"]')!

    const capture = await captureMutations(host, () => control.click())

    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(control.dataset.state).toBe('checked')
    expect(host.querySelector('[role="switch"]')).toBe(control)
    expect(control.querySelector('[data-slot="switch-thumb"]')).toBe(thumb)
    expect(() =>
      assertMutationEnvelope(
        capture.records,
        [{ type: 'attributes', target: control }],
        'switch state update',
      ),
    ).not.toThrow()
  })

  it('updates the documentation counter in place', async () => {
    const host = await mount(DocsPageProof)
    const button = host.querySelector<HTMLButtonElement>('button')!
    const output = host.querySelector<HTMLOutputElement>('[data-testid="docs-counter"]')!

    const capture = await captureMutations(host, () => button.click())

    expect(output.textContent).toContain('Count: 1')
    expect(host.querySelector('[data-testid="docs-counter"]')).toBe(output)
    expect(capture.records.some((record) => record.type === 'characterData')).toBe(true)
  })

  it('opens mobile navigation and changes theme without replacing the docs shell', async () => {
    const host = await mount(DocsLayoutProof)
    const header = host.querySelector<HTMLElement>('[data-testid="docs-header"]')!
    const sidebar = host.querySelector<HTMLElement>('[data-testid="docs-sidebar"]')!
    const menu = host.querySelector<HTMLButtonElement>('[aria-label="Toggle navigation"]')!
    const theme = host.querySelector<HTMLButtonElement>('[aria-label="Toggle color theme"]')!

    await captureMutations(host, () => menu.click())
    expect(menu.getAttribute('aria-expanded')).toBe('true')
    expect(sidebar.classList.contains('translate-x-0')).toBe(true)
    expect(host.querySelector('[data-testid="docs-header"]')).toBe(header)
    expect(host.querySelector('[data-testid="docs-sidebar"]')).toBe(sidebar)

    await captureMutations(host, () => theme.click())
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(host.querySelector('[data-testid="docs-header"]')).toBe(header)
  })
})

async function mount(Component: () => unknown): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  dispose = mountCompiled(Component as unknown as () => CompiledComponentResult, host).dispose
  await Promise.resolve()
  return host
}
