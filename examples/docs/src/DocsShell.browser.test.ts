import { mountCompiled, type CompiledComponentResult } from '@vidact/runtime'
import { captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DocsLayoutProof,
  DocsPageProof,
  LandingCompilerProof,
  LandingCounterProof,
  LandingEnginesProof,
} from './DocsShellProof.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  document.documentElement.classList.remove('dark')
  vi.restoreAllMocks()
})

describe('Vidact-native documentation controls', () => {
  it('switches compiler views without resetting the running counter', async () => {
    const host = await mount(LandingCompilerProof)
    const output = host.querySelector<HTMLOutputElement>('output')!
    const increment = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Increment',
    )!

    increment.click()
    expect(output.textContent).toBe('Count: 1')
    expect(host.querySelector('#compiler-code pre')!.textContent).toContain(
      "document.createElement('button')",
    )

    const component = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Component',
    )!
    await captureMutations(host, () => component.click())
    expect(host.querySelector('#compiler-code pre')!.textContent).toContain('useState(0)')
    expect(host.querySelector('output')).toBe(output)
    expect(output.textContent).toBe('Count: 1')

    const actual = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Actual output',
    )!
    await captureMutations(host, () => actual.click())
    expect(host.querySelector('#compiler-code pre')!.textContent).toContain('createCompiledState')
    expect(actual.getAttribute('aria-selected')).toBe('true')
  })

  it('reports clipboard success only after writing and allows a failed write to be retried', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    const pending = Promise.withResolvers<void>()
    write.mockReturnValueOnce(pending.promise).mockResolvedValueOnce()
    const host = await mount(DocsPageProof)
    const copy = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Copy',
    )!

    copy.click()
    expect(copy.textContent).toBe('Copying…')
    expect(copy.disabled).toBe(true)
    pending.reject(new Error('Clipboard permission denied'))
    await expect.poll(() => copy.textContent).toBe('Copy failed · retry')
    expect(copy.disabled).toBe(false)

    copy.click()
    await expect.poll(() => copy.textContent).toBe('Copied')
    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith('const count = 0')
    expect(host.contains(copy)).toBe(true)
  })

  it('keeps docs preview keys unique after adding, removing, and reordering rows', async () => {
    const host = await mount(DocsPageProof)
    const list = host.querySelector<HTMLUListElement>('[data-testid="docs-list"]')!
    const retained = [...list.querySelectorAll('li')].slice(1)
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((item) => item.textContent === label)!

    await captureMutations(host, () => button('Add').click())
    await captureMutations(host, () => button('Remove first').click())
    await captureMutations(host, () => button('Add').click())
    const rows = [...list.querySelectorAll('li')]
    expect(rows.map((row) => row.textContent)).toEqual(['Mount', 'Update', 'Item 4', 'Item 5'])
    expect(rows[0]).toBe(retained[0])
    expect(rows[1]).toBe(retained[1])

    await captureMutations(host, () => button('Reverse').click())
    const reversed = [...list.querySelectorAll('li')]
    rows.toReversed().forEach((row, index) => expect(reversed[index]).toBe(row))
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
