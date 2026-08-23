import { captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { hydrateRoot } from '../../src/hydrate.ts'
import {
  binding,
  choose,
  compiledRoot,
  createCompiledScope,
  createCompiledId,
  createCompiledState,
  createRoot,
  deferred,
  errorBoundary,
  Fragment,
  h,
  keyed,
  mountHotRoot,
  source,
  useLayoutEffect,
  type HotContext,
} from '../../src/index.ts'
import {
  Fragment as ServerFragment,
  jsx as serverJsx,
  jsxs as serverJsxs,
  renderToStaticMarkup,
  renderToString,
  useId as useServerId,
  useState as useServerState,
  type ServerChild,
} from '../../src/server.ts'

afterEach(() => document.body.replaceChildren())

describe('compiled client roots', () => {
  it('mounts one application factory and unmounts terminally', () => {
    const host = document.createElement('div')
    host.append(document.createTextNode('previous'))
    document.body.append(host)
    let setCount!: ReturnType<typeof createCompiledState<number>>['set']
    const application = () => {
      const scope = createCompiledScope()
      const count = createCompiledState(scope, source(0), 0)
      setCount = count.set
      return compiledRoot(scope, () => h('output', null, count.get()))
    }
    const root = createRoot(host, { identifierPrefix: 'root-' })

    root.mount(application)

    expect(host.textContent).toBe('0')
    expect(() => root.mount(application)).toThrow('already has a mounted application')

    root.unmount()

    expect(host.childNodes).toHaveLength(0)
    expect(() => setCount(1)).toThrow('cannot update state after disposal')
    expect(() => root.mount(application)).toThrow('cannot mount an unmounted root')
    expect(() => root.unmount()).not.toThrow()
  })

  it('replaces hot roots with owner cleanup and an explicit local-state reset boundary', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const data: Record<string, unknown> = {}
    const cleanups: string[] = []
    let disposeHot = (_data: Record<string, unknown>): void => {}
    let pruneHot = (): void => {}
    let accepted = 0
    const hot = (): HotContext => ({
      data,
      accept: () => {
        accepted += 1
      },
      dispose: (callback) => {
        disposeHot = callback
      },
      prune: (callback) => {
        pruneHot = callback
      },
    })
    let setCount!: ReturnType<typeof createCompiledState<number>>['set']
    const application = (label: string) => () => {
      const scope = createCompiledScope()
      const count = createCompiledState(scope, source(0), 0)
      setCount = count.set
      useLayoutEffect(
        () => () => {
          cleanups.push(label)
        },
        [],
      )
      return compiledRoot(scope, () =>
        h('button', null, label, ':', binding(scope, source(0), count.get)),
      )
    }

    mountHotRoot(hot(), host, application('first'))
    const firstButton = host.querySelector('button')
    setCount(1)
    expect(firstButton?.textContent).toBe('first:1')
    disposeHot(data)

    mountHotRoot(hot(), host, application('second'))
    expect(host.querySelector('button')).not.toBe(firstButton)
    expect(host.textContent).toBe('second:0')
    expect(cleanups).toEqual(['first'])
    expect(accepted).toBe(2)

    pruneHot()
    expect(host.childNodes).toHaveLength(0)
    expect(cleanups).toEqual(['first', 'second'])
  })

  it('hydrates matching versioned markup without replacing elements or text', async () => {
    const host = document.createElement('div')
    function ServerCounter(): ServerChild {
      const [count] = useServerState(0)
      return serverJsx('button', { children: count })
    }
    host.innerHTML = renderToString(() => serverJsx(ServerCounter, null))
    document.body.append(host)
    const existingButton = host.querySelector('button')!
    const existingText = [...existingButton.childNodes].find((node) => node instanceof Text)!
    const countSource = source(0)
    let setCount!: ReturnType<typeof createCompiledState<number>>['set']
    const recoveries: unknown[] = []

    const hydration = await captureMutations(host, () =>
      hydrateRoot(
        host,
        () => {
          const scope = createCompiledScope()
          const count = createCompiledState(scope, countSource, 0)
          setCount = count.set
          return compiledRoot(scope, () =>
            h(
              'button',
              { onClick: () => setCount((value) => value + 1) },
              binding(scope, countSource, count.get),
            ),
          )
        },
        { onRecoverableError: (error) => recoveries.push(error) },
      ),
    )
    const root = hydration.result

    expect(recoveries).toEqual([])
    expect(hydration.records).toHaveLength(0)
    expect(host.querySelector('button')).toBe(existingButton)
    expect([...existingButton.childNodes].find((node) => node instanceof Text)).toBe(existingText)
    existingButton.click()
    expect(existingText.data).toBe('1')

    root.unmount()
    expect(host.childNodes).toHaveLength(0)
  })

  it('reports a marker mismatch and recovers at the whole-root boundary', () => {
    const host = document.createElement('div')
    host.innerHTML =
      '<!--vidact:v1:r--><!--vidact:v1:b--><!--vidact:v1:c--><!--vidact:v1:b--><!--vidact:v1:s--><button><!--vidact:v1:b--><!--vidact:v1:t-->wrong<!--/vidact:v1:t--><!--/vidact:v1:b--></button><!--/vidact:v1:s--><!--/vidact:v1:b--><!--/vidact:v1:c--><!--/vidact:v1:b--><!--/vidact:v1:r-->'
    document.body.append(host)
    const serverButton = host.querySelector('button')!
    const recoveries: unknown[] = []

    const root = hydrateRoot(
      host,
      () => {
        const scope = createCompiledScope()
        return compiledRoot(scope, () => h('button', null, 'right'))
      },
      { onRecoverableError: (error) => recoveries.push(error) },
    )

    expect(recoveries).toHaveLength(1)
    expect(String(recoveries[0])).toContain('server text')
    expect(host.querySelector('button')).not.toBe(serverButton)
    expect(host.textContent).toBe('right')
    root.unmount()
  })

  it('recovers from an unsupported hydration protocol version', () => {
    const host = document.createElement('div')
    host.innerHTML = '<!--vidact:v2:r--><p>stale</p><!--/vidact:v2:r-->'
    document.body.append(host)
    const recoveries: unknown[] = []

    const root = hydrateRoot(
      host,
      () => {
        const scope = createCompiledScope()
        return compiledRoot(scope, () => h('p', null, 'current'))
      },
      { onRecoverableError: (error) => recoveries.push(error) },
    )

    expect(recoveries).toHaveLength(1)
    expect(String(recoveries[0])).toContain('vidact:v1')
    expect(host.textContent).toBe('current')
    root.unmount()
  })

  it('uses the same root-prefixed id sequence as server rendering', async () => {
    const host = document.createElement('div')
    function ServerLabel(): ServerChild {
      const id = useServerId()
      return serverJsxs('label', {
        children: ['Name', serverJsx('input', { id })],
        htmlFor: id,
      })
    }
    host.innerHTML = renderToString(() => serverJsx(ServerLabel, null), {
      identifierPrefix: 'app-',
    })
    document.body.append(host)
    const serverInput = host.querySelector('input')!

    const hydration = await captureMutations(host, () =>
      hydrateRoot(
        host,
        () => {
          const scope = createCompiledScope()
          const id = createCompiledId(scope)
          return compiledRoot(scope, () => h('label', { htmlFor: id }, 'Name', h('input', { id })))
        },
        { identifierPrefix: 'app-' },
      ),
    )
    const root = hydration.result

    expect(hydration.records).toHaveLength(0)
    expect(host.querySelector('input')).toBe(serverInput)
    expect(serverInput.id).toBe(':app-r0:')
    expect(host.querySelector('label')?.htmlFor).toBe(':app-r0:')
    root.unmount()
  })

  it('reconstructs keyed records from a server array range without remounting rows', async () => {
    const host = document.createElement('div')
    const serverItems = [
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]
    function ServerList(): ServerChild {
      return serverJsx('ul', {
        children: serverItems.map((item) => serverJsx('li', { children: item.label }, item.id)),
      })
    }
    host.innerHTML = renderToString(() => serverJsx(ServerList, null))
    document.body.append(host)
    const rows = [...host.querySelectorAll('li')]
    const itemsSource = source(0)
    let setItems!: ReturnType<
      typeof createCompiledState<readonly { readonly id: number; readonly label: string }[]>
    >['set']

    const hydration = await captureMutations(host, () =>
      hydrateRoot(host, () => {
        const scope = createCompiledScope()
        const items = createCompiledState<
          readonly { readonly id: number; readonly label: string }[]
        >(scope, itemsSource, [
          { id: 1, label: 'one' },
          { id: 2, label: 'two' },
        ])
        setItems = items.set
        return compiledRoot(scope, () =>
          h(
            'ul',
            null,
            keyed(
              scope,
              itemsSource,
              items.get,
              (item) => item.id,
              (item, _index, itemScope) =>
                h(
                  'li',
                  null,
                  binding(itemScope, source(0), () => item.get().label),
                ),
            ),
          ),
        )
      }),
    )

    expect(hydration.records).toHaveLength(0)
    expect([...host.querySelectorAll('li')]).toEqual(rows)
    setItems((items) => [items[1]!, items[0]!])
    expect([...host.querySelectorAll('li')]).toEqual([rows[1], rows[0]])
    hydration.result.unmount()
  })

  it('claims the selected branch inside its server child slot', async () => {
    const host = document.createElement('div')
    function ServerBranch(): ServerChild {
      return serverJsx('section', {
        children: serverJsx('p', { children: 'yes' }),
      })
    }
    host.innerHTML = renderToString(() => serverJsx(ServerBranch, null))
    document.body.append(host)
    const serverParagraph = host.querySelector('p')!
    const visibleSource = source(0)
    let setVisible!: ReturnType<typeof createCompiledState<boolean>>['set']

    const hydration = await captureMutations(host, () =>
      hydrateRoot(host, () => {
        const scope = createCompiledScope()
        const visible = createCompiledState(scope, visibleSource, true)
        setVisible = visible.set
        return compiledRoot(scope, () =>
          h(
            'section',
            null,
            choose(
              scope,
              visibleSource,
              'truthy',
              visible.get,
              () => h('p', null, 'yes'),
              () => h('p', null, 'no'),
            ),
          ),
        )
      }),
    )

    expect(hydration.records).toHaveLength(0)
    expect(host.querySelector('p')).toBe(serverParagraph)
    setVisible(false)
    expect(host.querySelector('p')).not.toBe(serverParagraph)
    expect(host.textContent).toBe('no')
    hydration.result.unmount()
  })

  it('claims wrapper-free fragment roots without moving their nodes', async () => {
    const host = document.createElement('div')
    function ServerFragmentRoot(): ServerChild {
      return serverJsxs(ServerFragment, {
        children: [serverJsx('span', { children: 'one' }), serverJsx('span', { children: 'two' })],
      })
    }
    host.innerHTML = renderToString(() => serverJsx(ServerFragmentRoot, null))
    document.body.append(host)
    const serverSpans = [...host.querySelectorAll('span')]
    const recoveries: unknown[] = []

    const hydration = await captureMutations(host, () =>
      hydrateRoot(
        host,
        () => {
          const scope = createCompiledScope()
          return compiledRoot(scope, () =>
            h(Fragment, null, h('span', null, 'one'), h('span', null, 'two')),
          )
        },
        { onRecoverableError: (error) => recoveries.push(error) },
      ),
    )

    expect(recoveries).toEqual([])
    expect(hydration.records).toHaveLength(0)
    expect([...host.querySelectorAll('span')]).toEqual(serverSpans)
    hydration.result.unmount()
  })

  it('claims direct array and deferred root values without remounting', async () => {
    const arrayHost = document.createElement('div')
    function ServerArrayRoot(): ServerChild {
      return [serverJsx('i', { children: 'one' }), serverJsx('i', { children: 'two' })]
    }
    arrayHost.innerHTML = renderToString(() => serverJsx(ServerArrayRoot, null))
    document.body.append(arrayHost)
    const serverItems = [...arrayHost.querySelectorAll('i')]

    const arrayHydration = await captureMutations(arrayHost, () =>
      hydrateRoot(arrayHost, () => {
        const scope = createCompiledScope()
        return compiledRoot(scope, () => [h('i', null, 'one'), h('i', null, 'two')])
      }),
    )

    expect(arrayHydration.records).toHaveLength(0)
    expect([...arrayHost.querySelectorAll('i')]).toEqual(serverItems)
    arrayHydration.result.unmount()

    const deferredHost = document.createElement('div')
    function ServerDeferredRoot(): ServerChild {
      return serverJsx('strong', { children: 'later' })
    }
    deferredHost.innerHTML = renderToString(() => serverJsx(ServerDeferredRoot, null))
    document.body.append(deferredHost)
    const serverStrong = deferredHost.querySelector('strong')

    const deferredHydration = await captureMutations(deferredHost, () =>
      hydrateRoot(deferredHost, () => {
        const scope = createCompiledScope()
        return compiledRoot(scope, () => deferred(() => h('strong', null, 'later')))
      }),
    )

    expect(deferredHydration.records).toHaveLength(0)
    expect(deferredHost.querySelector('strong')).toBe(serverStrong)
    deferredHydration.result.unmount()
  })

  it('adopts matching raw HTML and commits refs before layout effects', async () => {
    const host = document.createElement('div')
    function ServerRawRoot(): ServerChild {
      return serverJsx('section', {
        dangerouslySetInnerHTML: { __html: '<em data-server="yes">trusted</em>' },
      })
    }
    host.innerHTML = renderToString(() => serverJsx(ServerRawRoot, null))
    document.body.append(host)
    const serverSection = host.querySelector('section')!
    const serverEmphasis = host.querySelector('em')!
    const commits: string[] = []

    const hydration = await captureMutations(host, () =>
      hydrateRoot(host, () => {
        const scope = createCompiledScope()
        useLayoutEffect(() => {
          commits.push(`layout:${String(host.querySelector('section') === serverSection)}`)
        }, [])
        return compiledRoot(scope, () =>
          h('section', {
            dangerouslySetInnerHTML: { __html: '<em data-server="yes">trusted</em>' },
            ref: (element: Element | null) => {
              commits.push(`ref:${String(element === serverSection)}`)
            },
          }),
        )
      }),
    )

    expect(hydration.records).toHaveLength(0)
    expect(host.querySelector('section')).toBe(serverSection)
    expect(host.querySelector('em')).toBe(serverEmphasis)
    expect(commits).toEqual(['ref:true', 'layout:true'])
    expect(() =>
      renderToString(() =>
        serverJsx('section', {
          dangerouslySetInnerHTML: { __html: '<!--vidact:v1:c-->forged' },
        }),
      ),
    ).toThrow('raw HTML cannot contain Vidact hydration marker syntax')
    expect(
      renderToStaticMarkup(() =>
        serverJsx('section', {
          dangerouslySetInnerHTML: { __html: '<!--vidact:v1:c-->static' },
        }),
      ),
    ).toBe('<section><!--vidact:v1:c-->static</section>')
    hydration.result.unmount()
    expect(commits).toEqual(['ref:true', 'layout:true', 'ref:false'])
  })

  it('recovers the whole root when opaque server HTML differs', () => {
    const host = document.createElement('div')
    function ServerRawRoot(): ServerChild {
      return serverJsx('section', {
        dangerouslySetInnerHTML: { __html: '<em>server</em>' },
      })
    }
    host.innerHTML = renderToString(() => serverJsx(ServerRawRoot, null))
    document.body.append(host)
    const serverSection = host.querySelector('section')
    const recoveries: unknown[] = []

    const root = hydrateRoot(
      host,
      () => {
        const scope = createCompiledScope()
        return compiledRoot(scope, () =>
          h('section', { dangerouslySetInnerHTML: { __html: '<u>client</u>' } }),
        )
      },
      { onRecoverableError: (error) => recoveries.push(error) },
    )

    expect(recoveries).toHaveLength(1)
    expect(String(recoveries[0])).toContain('raw HTML')
    expect(host.querySelector('section')).not.toBe(serverSection)
    expect(host.innerHTML).toContain('<u>client</u>')
    root.unmount()
  })

  it('adopts controlled form state and restores it after native input', async () => {
    const host = document.createElement('div')
    function ServerFormRoot(): ServerChild {
      return serverJsx('input', { value: 'fixed' })
    }
    host.innerHTML = renderToString(() => serverJsx(ServerFormRoot, null))
    document.body.append(host)
    const serverInput = host.querySelector('input')!

    const hydration = await captureMutations(host, () =>
      hydrateRoot(host, () => {
        const scope = createCompiledScope()
        return compiledRoot(scope, () => h('input', { value: 'fixed' }))
      }),
    )

    expect(hydration.records).toHaveLength(0)
    expect(host.querySelector('input')).toBe(serverInput)
    serverInput.value = 'user edit'
    serverInput.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await Promise.resolve()
    expect(serverInput.value).toBe('fixed')
    hydration.result.unmount()
  })

  it('claims the primary error-boundary range without remounting it', async () => {
    const host = document.createElement('div')
    function ServerBoundaryRoot(): ServerChild {
      return serverJsx('p', { children: 'primary' })
    }
    host.innerHTML = renderToString(() => serverJsx(ServerBoundaryRoot, null))
    document.body.append(host)
    const serverParagraph = host.querySelector('p')
    const failureSource = source(0)
    let setFailure!: ReturnType<typeof createCompiledState<number>>['set']

    const hydration = await captureMutations(host, () =>
      hydrateRoot(host, () => {
        const scope = createCompiledScope()
        const failure = createCompiledState(scope, failureSource, 0)
        setFailure = failure.set
        return compiledRoot(scope, () =>
          errorBoundary(
            () =>
              h(
                'p',
                null,
                binding(scope, failureSource, () => {
                  if (failure.get() === 1) throw new Error('hydrated failure')
                  return 'primary'
                }),
              ),
            (error) => h('p', null, (error as Error).message),
          ),
        )
      }),
    )

    expect(hydration.records).toHaveLength(0)
    expect(host.querySelector('p')).toBe(serverParagraph)
    expect(() => setFailure(1)).not.toThrow()
    expect(serverParagraph?.isConnected).toBe(false)
    expect(host.textContent).toBe('hydrated failure')
    hydration.result.unmount()
  })
})
