import { mountCompiled, type CompiledComponentResult } from '@vidact/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import { DocsSearchProof } from './DocsShellProof.tsx'

type FetchDocs = (url: string, options: RequestInit) => Promise<Response>

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const result = (name: string, id = name) => ({
  id,
  title: name,
  content: name,
  group: 'Learn',
  type: 'heading',
  url: `/docs/learn/state#${id}`,
})

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  dispose = mountCompiled(DocsSearchProof as unknown as () => CompiledComponentResult, host).dispose
  await Promise.resolve()
  const button = host.querySelector<HTMLButtonElement>('button')!
  button.focus()
  return { host, button }
}

async function open() {
  const mounted = await mount()
  mounted.button.click()
  await expect.poll(() => document.querySelector('dialog')?.open).toBe(true)
  return { ...mounted, input: document.querySelector<HTMLInputElement>('[role="combobox"]')! }
}

describe('documentation search', () => {
  it('supports both shortcuts, modal focus, selection, and Escape restoration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchDocs>().mockResolvedValue(Response.json([result('State'), result('Effects')])),
    )
    const { host, button } = await mount()
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }),
    )
    await expect.poll(() => document.querySelector('dialog')?.open).toBe(true)
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!
    expect(document.activeElement).toBe(input)
    await userEvent.type(input, 'state')
    await expect.poll(() => host.querySelectorAll('[role="option"]').length).toBe(2)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await expect
      .poll(() => input.getAttribute('aria-activedescendant'))
      .toBe('docs-search-result-1')
    const selected = host.querySelector<HTMLAnchorElement>('#docs-search-result-1')!
    let selectedUrl = ''
    selected.addEventListener('click', (event) => {
      event.preventDefault()
      selectedUrl = selected.getAttribute('href')!
    })
    await userEvent.keyboard('{Enter}')
    expect(selectedUrl).toBe('/docs/learn/state#Effects')
    await expect.poll(() => document.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    await expect.poll(() => document.querySelector('dialog')?.open).toBe(true)
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('ignores late responses, cancels old queries, and preserves the input node', async () => {
    let resolveOld!: (response: Response) => void
    let oldSignal: AbortSignal | undefined
    const fetcher = vi.fn<FetchDocs>((_url, options) => {
      if (fetcher.mock.calls.length === 1) {
        oldSignal = options.signal as AbortSignal
        return new Promise<Response>((resolve) => {
          resolveOld = resolve
        })
      }
      return Promise.resolve(Response.json([result('New result')]))
    })
    vi.stubGlobal('fetch', fetcher)
    const { input } = await open()
    await userEvent.type(input, 'old')
    await expect.poll(() => fetcher.mock.calls.length).toBe(1)
    await userEvent.clear(input)
    await userEvent.type(input, 'new')
    await expect
      .poll(() => document.querySelector('[role="option"]')?.textContent)
      .toContain('New result')
    expect(oldSignal?.aborted).toBe(true)
    resolveOld(Response.json([result('Old result')]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.querySelector('[role="option"]')?.textContent).toContain('New result')
    expect(document.querySelector('[role="combobox"]')).toBe(input)
    expect(document.activeElement).toBe(input)
  })

  it('shows empty and failure states, and aborts pending work on disposal', async () => {
    const fetcher = vi
      .fn<FetchDocs>()
      .mockResolvedValueOnce(Response.json([]))
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetcher)
    const { input } = await open()
    await userEvent.type(input, 'missing')
    await expect
      .poll(() => document.querySelector('dialog')?.textContent)
      .toContain('No results for')
    await userEvent.type(input, 'x')
    await expect
      .poll(() => document.querySelector('[role="alert"]')?.textContent)
      .toContain('Search is unavailable')
    let pendingSignal: AbortSignal | undefined
    fetcher.mockImplementationOnce((_url: string, options: RequestInit) => {
      pendingSignal = options.signal as AbortSignal
      return new Promise<Response>(() => {})
    })
    await userEvent.type(input, 'y')
    await expect.poll(() => pendingSignal).toBeDefined()
    dispose?.()
    dispose = undefined
    expect(pendingSignal?.aborted).toBe(true)
    expect(document.body.style.overflow).not.toBe('hidden')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    expect(document.querySelector('dialog')).toBeNull()
  })
})
