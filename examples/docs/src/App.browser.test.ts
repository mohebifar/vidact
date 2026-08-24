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

    expect(host.querySelector('h1')?.textContent).toContain('Your component runs once')
    expect(host.textContent).toContain('Tested in Chromium, Firefox, and WebKit')
    expect(host.textContent).toContain('Do not take "surgical" on faith')

    await act(() => clickLink(host, '/docs'))
    expect(window.location.pathname).toBe('/docs')
    expect(host.querySelector('h1')?.textContent).toBe(
      'Build a counter that updates without rerendering',
    )
    expect(host.textContent).toContain("The button's text changes")
    expect(host.querySelector('header')).toBe(header)

    await act(() => clickLink(host, '/docs/mental-model'))
    expect(host.querySelector('h1')?.textContent).toBe('Why a state write can skip the component')
    expect(host.textContent).toContain('No subscription pass')

    await act(() => clickLink(host, '/examples'))
    expect(host.querySelector('h1')?.textContent).toContain('Run the cases that are hard to fake')
    expect(host.textContent).toContain('TodoMVC')
    expect(host.textContent).toContain('Async shop')

    await act(() => clickLink(host, '/blog'))
    expect(host.querySelector('h1')?.textContent).toBe(
      'What Vidact learns before your code reaches the browser',
    )
    expect(host.textContent).toContain('React analysis boundary')
    await act(() => clickLink(host, '/blog/compiler-not-runtime'))
    expect(host.querySelector('h1')?.textContent).toBe('Why Vidact puts reactivity in the compiler')
    expect(host.textContent).toContain('A setter already tells us what changed')
  })

  it('responds to browser history navigation', async () => {
    const host = await mountApp('/docs')
    expect(host.querySelector('h1')?.textContent).toBe(
      'Build a counter that updates without rerendering',
    )

    await act(() => {
      window.history.pushState({}, '', '/examples')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(host.querySelector('h1')?.textContent).toContain('Run the cases that are hard to fake')
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
