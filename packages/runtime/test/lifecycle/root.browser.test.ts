import { captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { hydrateRoot } from '../../src/hydrate.ts'
import {
  binding,
  compiledRoot,
  createCompiledScope,
  createCompiledId,
  createCompiledState,
  createRoot,
  h,
  source,
} from '../../src/index.ts'

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
    host.innerHTML =
      '<!--vidact:v1:r--><!--vidact:v1:c--><button><!--vidact:v1:t-->0<!--/vidact:v1:t--></button><!--/vidact:v1:c--><!--/vidact:v1:r-->'
    document.body.append(host)
    const existingButton = host.querySelector('button')!
    const existingText = [...existingButton.childNodes].find((node) => node instanceof Text)!
    const countSource = source(0)
    let setCount!: ReturnType<typeof createCompiledState<number>>['set']

    const hydration = await captureMutations(host, () =>
      hydrateRoot(host, () => {
        const scope = createCompiledScope()
        const count = createCompiledState(scope, countSource, 0)
        setCount = count.set
        return compiledRoot(scope, () => h('button', null, binding(scope, countSource, count.get)))
      }),
    )
    const root = hydration.result

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
      '<!--vidact:v1:r--><!--vidact:v1:c--><button><!--vidact:v1:t-->wrong<!--/vidact:v1:t--></button><!--/vidact:v1:c--><!--/vidact:v1:r-->'
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

  it('uses the same root-prefixed id sequence as server rendering', () => {
    const host = document.createElement('div')
    host.innerHTML =
      '<!--vidact:v1:r--><!--vidact:v1:c--><label for=":app-r0:"><!--vidact:v1:t-->Name<!--/vidact:v1:t--><input id=":app-r0:"></label><!--/vidact:v1:c--><!--/vidact:v1:r-->'
    document.body.append(host)
    const serverInput = host.querySelector('input')!

    const root = hydrateRoot(
      host,
      () => {
        const scope = createCompiledScope()
        const id = createCompiledId(scope)
        return compiledRoot(scope, () => h('label', { htmlFor: id }, 'Name', h('input', { id })))
      },
      { identifierPrefix: 'app-' },
    )

    expect(host.querySelector('input')).toBe(serverInput)
    expect(serverInput.id).toBe(':app-r0:')
    expect(host.querySelector('label')?.htmlFor).toBe(':app-r0:')
    root.unmount()
  })
})
