import { afterEach, describe, expect, it } from 'vitest'

import {
  compiledRoot,
  createCompiledScope,
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
})
