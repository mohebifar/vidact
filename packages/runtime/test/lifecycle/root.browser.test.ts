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
  h,
  keyed,
  source,
} from '../../src/index.ts'
import {
  jsx as serverJsx,
  jsxs as serverJsxs,
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
            h('button', null, binding(scope, countSource, count.get)),
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
    setCount(1)
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
})
