import { afterEach, describe, expect, it } from 'vitest'

import {
  binding,
  compiledRoot,
  createCompiledScope,
  createCompiledState,
} from '../../src/compiled/core.ts'
import { Fragment, h } from '../../src/direct-dom.ts'
import { createEventReplayQueue, hydrateFrameworkBoundary } from '../../src/framework-hydrate.ts'
import {
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  enableFrameworkMetadata,
} from '../../src/framework.ts'
import { mountCompiled } from '../../src/index.ts'
import { source } from '../../src/source-mask.ts'

describe('framework browser helpers', () => {
  afterEach(() => {
    document.head.querySelectorAll('[data-vidact-framework-test]').forEach((node) => node.remove())
    document.body.replaceChildren()
  })

  it('deduplicates resource hints and preinitialized assets', () => {
    preconnect('https://cdn.example.test', { crossOrigin: 'anonymous' })
    preconnect('https://cdn.example.test', { crossOrigin: 'anonymous' })
    prefetchDNS('https://dns.example.test')
    preload('/font.woff2', { as: 'font', type: 'font/woff2' })
    preloadModule('/chunk.js')
    preinit('/app.css', { as: 'style', precedence: 'app' })
    preinitModule('/app.js')

    const created = [
      document.head.querySelector('link[rel="preconnect"]'),
      document.head.querySelector('link[rel="dns-prefetch"]'),
      document.head.querySelector('link[rel="preload"]'),
      document.head.querySelector('link[rel="modulepreload"]'),
      document.head.querySelector('link[rel="stylesheet"]'),
      document.head.querySelector('script[type="module"]'),
    ].filter((element): element is Element => element !== null)
    for (const element of created) element.setAttribute('data-vidact-framework-test', '')
    expect(created).toHaveLength(6)
    expect(document.head.querySelectorAll('link[rel="preconnect"]')).toHaveLength(1)
    expect(
      document.head.querySelector('link[rel="stylesheet"]')?.getAttribute('data-precedence'),
    ).toBe('app')
  })

  it('captures and replays pre-hydration events against stable node paths', () => {
    const host = document.createElement('div')
    host.innerHTML = '<label><input value="server"><button>submit</button></label>'
    document.body.append(host)
    const input = host.querySelector('input')!
    const button = host.querySelector('button')!
    const queue = createEventReplayQueue(host)

    input.value = 'typed before hydration'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    button.click()
    expect(queue.size()).toBe(2)

    const events: string[] = []
    input.value = 'server'
    input.addEventListener('input', () => events.push(`input:${input.value}`))
    button.addEventListener('click', () => events.push('click'))
    queue.replay()

    expect(events).toEqual(['input:typed before hydration', 'click'])
    expect(input.value).toBe('typed before hydration')
    expect(queue.size()).toBe(0)
  })

  it('disposes event replay capture when boundary hydration fails', () => {
    const host = document.createElement('div')
    host.innerHTML = '<button>submit</button>'
    document.body.append(host)
    const button = host.querySelector('button')!
    const queue = createEventReplayQueue(host)

    expect(() =>
      hydrateFrameworkBoundary(
        host,
        () => {
          throw new Error('hydrate application failed')
        },
        { replay: queue },
      ),
    ).toThrow('hydrate application failed')

    button.click()
    expect(queue.size()).toBe(0)
  })

  it('hoists reactive metadata with last-owner precedence and restores it on disposal', () => {
    enableFrameworkMetadata()
    const originalTitle = document.title
    const titleSource = source(0)
    let setTitle!: (value: string) => void
    const firstHost = document.createElement('div')
    const first = mountCompiled(() => {
      const scope = createCompiledScope()
      const title = createCompiledState(scope, titleSource, 'first')
      setTitle = title.set
      return compiledRoot(scope, () =>
        h(
          Fragment,
          null,
          h('title', null, binding(scope, titleSource, title.get)),
          h('main', null, 'one'),
        ),
      )
    }, firstHost)
    expect(firstHost.textContent).toBe('one')
    expect(document.title).toBe('first')

    const secondHost = document.createElement('div')
    const second = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () =>
        h(Fragment, null, h('title', null, 'second'), h('main', null, 'two')),
      )
    }, secondHost)
    expect(document.title).toBe('second')
    setTitle('FIRST')
    expect(document.title).toBe('second')

    second.dispose()
    expect(document.title).toBe('FIRST')
    first.dispose()
    expect(document.title).toBe(originalTitle)
  })

  it('leaves item metadata and manually managed links in place', () => {
    enableFrameworkMetadata()
    const host = document.createElement('div')
    const root = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () =>
        h(
          Fragment,
          null,
          h('title', { itemProp: 'name' }, 'item title'),
          h('meta', { itemProp: 'description', content: 'item description' }),
          h('link', { itemProp: 'author', href: '/author' }),
          h('link', { rel: 'stylesheet', href: '/manual.css' }),
          h('link', { rel: 'icon', href: '/managed.ico', onLoad: () => undefined }),
        ),
      )
    }, host)

    expect(host.querySelector('title[itemprop="name"]')?.textContent).toBe('item title')
    expect(host.querySelector('meta[itemprop="description"]')).not.toBeNull()
    expect(host.querySelector('link[itemprop="author"]')).not.toBeNull()
    expect(host.querySelector('link[href="/manual.css"]')).not.toBeNull()
    expect(host.querySelector('link[href="/managed.ico"]')).not.toBeNull()
    root.dispose()
  })

  it('orders stylesheet precedence by first discovery instead of lexical value', () => {
    enableFrameworkMetadata()
    const host = document.createElement('div')
    const root = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () =>
        h(
          Fragment,
          null,
          h('link', { rel: 'stylesheet', href: '/first.css', precedence: 'z-first' }),
          h('link', { rel: 'stylesheet', href: '/second.css', precedence: 'a-second' }),
        ),
      )
    }, host)

    expect(
      [...document.head.querySelectorAll('link[rel="stylesheet"]')]
        .filter((link) => {
          const href = link.getAttribute('href') ?? ''
          return href.endsWith('/first.css') || href.endsWith('/second.css')
        })
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/first.css', '/second.css'])
    root.dispose()
  })

  it('rekeys reactive metadata identity props before another owner claims the old key', () => {
    enableFrameworkMetadata()
    const nameSource = source(0)
    let setName!: (value: string) => void
    const firstHost = document.createElement('div')
    const first = mountCompiled(() => {
      const scope = createCompiledScope()
      const name = createCompiledState(scope, nameSource, 'old-key')
      setName = name.set
      return compiledRoot(scope, () =>
        h('meta', { name: binding(scope, nameSource, name.get), content: 'first' }),
      )
    }, firstHost)

    setName('new-key')
    const secondHost = document.createElement('div')
    const second = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () => h('meta', { name: 'old-key', content: 'second' }))
    }, secondHost)

    expect(document.head.querySelector('meta[name="new-key"]')?.getAttribute('content')).toBe(
      'first',
    )
    expect(document.head.querySelector('meta[name="old-key"]')?.getAttribute('content')).toBe(
      'second',
    )
    second.dispose()
    expect(document.head.querySelector('meta[name="old-key"]')).toBeNull()
    expect(document.head.querySelector('meta[name="new-key"]')).not.toBeNull()
    first.dispose()
  })
})
