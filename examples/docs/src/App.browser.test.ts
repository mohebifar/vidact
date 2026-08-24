import { mountCompiled } from '@vidact/runtime'
import { act } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './App.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
})

describe('Vidact documentation app', () => {
  it('navigates between the landing page, compiled MDX docs, examples, and blog', async () => {
    const host = await mountApp('/')
    const header = host.querySelector('header')

    expect(host.querySelector('h1')?.textContent).toContain('Render once')

    await act(() => clickLink(host, '/docs'))
    expect(window.location.pathname).toBe('/docs')
    expect(host.querySelector('h1')?.textContent).toBe('Build your first Vidact app')
    expect(host.textContent).toContain('The component executes once')
    expect(host.querySelector('header')).toBe(header)

    await act(() => clickLink(host, '/docs/mental-model'))
    expect(host.querySelector('h1')?.textContent).toBe('The static updater model')
    expect(host.textContent).toContain('No runtime graph')

    await act(() => clickLink(host, '/examples'))
    expect(host.querySelector('h1')?.textContent).toContain('See surgical updates')
    expect(host.textContent).toContain('TodoMVC')
    expect(host.textContent).toContain('Async shop')

    await act(() => clickLink(host, '/blog'))
    expect(host.querySelector('h1')?.textContent).toBe('Notes on doing less.')
    await act(() => clickLink(host, '/blog/compiler-not-runtime'))
    expect(host.querySelector('h1')?.textContent).toBe('The compiler is the reactivity system')
    expect(host.textContent).toContain('Compilation is not a build optimization')
  })

  it('responds to browser history navigation', async () => {
    const host = await mountApp('/docs')
    expect(host.querySelector('h1')?.textContent).toBe('Build your first Vidact app')

    await act(() => {
      window.history.pushState({}, '', '/examples')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(host.querySelector('h1')?.textContent).toContain('See surgical updates')
  })
})

async function mountApp(path: string): Promise<HTMLElement> {
  window.history.replaceState({}, '', path)
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(() => {
    dispose = mountCompiled(App, host).dispose
  })
  return host
}

function clickLink(host: ParentNode, path: string): void {
  const link = host.querySelector<HTMLAnchorElement>(`a[href="${path}"]`)
  expect(link).not.toBeNull()
  link?.click()
}
