import { mountCompiled, type CompiledComponentResult } from '@vidact/runtime'
import { captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DocsLayoutProof,
  DocsPageProof,
  LandingCounterProof,
  LandingEnginesProof,
} from './DocsShellProof.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  document.documentElement.classList.remove('dark')
})

describe('Vidact-native documentation controls', () => {
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
