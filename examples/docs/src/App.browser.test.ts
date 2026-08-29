import { mountCompiled, type CompiledComponentResult } from '@vidact/runtime'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

import { App } from './App.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  document.documentElement.classList.remove('dark')
})

describe('Vidact shadcn documentation shell', () => {
  it('filters navigation surgically through the shadcn Base UI input', async () => {
    const host = await mountApp()
    const topbar = host.querySelector<HTMLElement>('[data-testid="topbar"]')!
    const article = host.querySelector<HTMLElement>('[data-testid="article"]')!
    const sidebar = host.querySelector<HTMLElement>('[data-testid="sidebar"]')!
    const search = host.querySelector<HTMLInputElement>('#docs-search')!

    const filtered = await captureMutations(host, () => userEvent.type(search, 'installation'))

    expect(search.value).toBe('installation')
    expect(document.activeElement).toBe(search)
    expect(host.querySelector('#docs-search')).toBe(search)
    expect(sidebar.textContent).toContain('Installation')
    expect(sidebar.textContent).not.toContain('Compatibility lab')
    expect(host.querySelector('[data-testid="topbar"]')).toBe(topbar)
    expect(host.querySelector('[data-testid="article"]')).toBe(article)
    expect(host.querySelector('[data-testid="sidebar"]')).toBe(sidebar)
    expect(() =>
      assertMutationEnvelope(
        filtered.records,
        [{ type: 'childList', within: sidebar }],
        'documentation navigation filter',
      ),
    ).not.toThrow()
  })

  it('uses Base UI buttons without replacing stable page owners', async () => {
    const host = await mountApp()
    const topbar = host.querySelector<HTMLElement>('[data-testid="topbar"]')!
    const article = host.querySelector<HTMLElement>('[data-testid="article"]')!
    const themeButton = host.querySelector<HTMLButtonElement>('[aria-label="Toggle color theme"]')!

    const themed = await captureMutations(host, () => themeButton.click())

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(themeButton.textContent).toContain('Light')
    expect(host.querySelector('[aria-label="Toggle color theme"]')).toBe(themeButton)
    expect(host.querySelector('[data-testid="topbar"]')).toBe(topbar)
    expect(host.querySelector('[data-testid="article"]')).toBe(article)
    expect(() =>
      assertMutationEnvelope(
        themed.records,
        [{ type: 'characterData', within: themeButton }],
        'theme label update',
      ),
    ).not.toThrow()
  })

  it('keeps the mobile navigation trigger state aligned with the owned sidebar', async () => {
    const host = await mountApp()
    const topbar = host.querySelector<HTMLElement>('[data-testid="topbar"]')!
    const article = host.querySelector<HTMLElement>('[data-testid="article"]')!
    const sidebar = host.querySelector<HTMLElement>('[data-testid="sidebar"]')!
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Toggle navigation"]')!

    const opened = await captureMutations(host, () => trigger.click())

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(sidebar.classList.contains('sidebar-open')).toBe(true)
    expect(host.querySelector('[aria-label="Close navigation"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="topbar"]')).toBe(topbar)
    expect(host.querySelector('[data-testid="article"]')).toBe(article)
    expect(host.querySelector('[data-testid="sidebar"]')).toBe(sidebar)
    expect(() =>
      assertMutationEnvelope(
        opened.records,
        [
          { type: 'attributes', within: topbar },
          { type: 'attributes', within: sidebar },
          { type: 'childList', within: host },
        ],
        'mobile navigation open',
      ),
    ).not.toThrow()

    const close = host.querySelector<HTMLButtonElement>('[aria-label="Close navigation"]')!
    const closed = await captureMutations(host, () => close.click())

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(sidebar.classList.contains('sidebar-open')).toBe(false)
    expect(host.querySelector('[aria-label="Close navigation"]')).toBeNull()
    expect(host.querySelector('[data-testid="topbar"]')).toBe(topbar)
    expect(host.querySelector('[data-testid="article"]')).toBe(article)
    expect(host.querySelector('[data-testid="sidebar"]')).toBe(sidebar)
    expect(() =>
      assertMutationEnvelope(
        closed.records,
        [
          { type: 'attributes', within: topbar },
          { type: 'attributes', within: sidebar },
          { type: 'childList', within: host },
        ],
        'mobile navigation close',
      ),
    ).not.toThrow()
  })
})

async function mountApp(): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  dispose = mountCompiled(App as unknown as () => CompiledComponentResult, host).dispose
  await Promise.resolve()
  return host
}
