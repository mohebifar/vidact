import { afterEach, describe, expect, it } from 'vitest'

import {
  binding,
  compiledRoot,
  createCompiledScope,
  createCompiledState,
} from '../../src/compiled.ts'
import { Fragment, h } from '../../src/direct-dom.ts'
import { createEventReplayQueue } from '../../src/framework-hydrate.ts'
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
})
