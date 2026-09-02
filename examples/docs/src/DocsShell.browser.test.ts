import { mountCompiled, type CompiledComponentResult } from '@vidact/runtime'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ButtonProof,
  DocsLayoutProof,
  DocsPageProof,
  LandingCounterProof,
  LandingEnginesProof,
  LandingHeroLogoProof,
  SwitchProof,
} from './DocsShellProof.tsx'

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

  it('renders every documentation block type on the client', async () => {
    const host = await mount(DocsPageProof)

    expect(host.querySelector('p code')!.textContent).toBe('mountCompiled')
    expect(host.querySelector('p a')!.getAttribute('href')).toBe('/docs/reference/runtime')
    expect(host.querySelector('p strong')!.textContent).toBe(' once')
    expect(host.querySelector('h3#steps')!.textContent).toBe('Steps')
    expect([...host.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual([
      'Compile',
      'Mount',
    ])
    expect(host.querySelector('ul li code')!.textContent).toBe('useState')
    expect(host.querySelector('[data-tone="tip"]')!.textContent).toContain('Callout body')
    expect(host.querySelector('td code')!.textContent).toBe('useRef')
    expect(host.querySelector('[aria-label="Table of contents"]')!.textContent).toBe(
      'Interactive proof',
    )
  })

  it('counts real DOM mutations in the landing counter demo', async () => {
    const host = await mount(LandingCounterProof)
    const button = host.querySelector<HTMLButtonElement>('button')!
    const output = host.querySelector<HTMLOutputElement>('output')!

    await captureMutations(host, () => button.click())
    await captureMutations(host, () => button.click())

    expect(output.textContent).toBe('Count: 2')
    expect(host.querySelector('output')).toBe(output)
    expect(Number(host.querySelector('[data-live]')!.textContent)).toBeGreaterThanOrEqual(2)
  })

  it('moves list rows with their checkbox state when reversed', async () => {
    const host = await mount(LandingEnginesProof)
    const first = host.querySelector<HTMLLIElement>('[data-engine="chromium"]')!
    const checkbox = first.querySelector<HTMLInputElement>('input')!

    checkbox.click()
    const reverse = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Reverse',
    )!
    await captureMutations(host, () => reverse.click())

    const rows = [...host.querySelectorAll('li')]
    expect(rows.at(-1)).toBe(first)
    expect(first.querySelector('input')!.checked).toBe(true)
  })

  it('mounts the crystal hero logo canvas lazily', async () => {
    if (!('gpu' in navigator)) return
    const adapter = await navigator.gpu.requestAdapter().catch(() => null)
    if (adapter === null) return

    const host = await mount(LandingHeroLogoProof)
    const stage = host.querySelector<HTMLElement>('[data-testid="hero-logo"]')!
    stage.style.width = '200px'
    stage.style.height = '200px'

    const canvas = await vi.waitFor(
      () => {
        const found = stage.querySelector('canvas')
        if (found === null) throw new Error('hero canvas is not mounted yet')
        return found
      },
      { interval: 100, timeout: 10_000 },
    )

    expect(canvas.isConnected).toBe(true)
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
