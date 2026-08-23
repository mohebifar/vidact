import { afterEach, describe, expect, it } from 'vitest'

import {
  binding,
  compiledRoot,
  createCompiledExternalStore,
  createCompiledScope,
  createCompiledState,
  h,
  mountCompiled,
  source,
  useLayoutEffect,
} from '../../src/index.ts'
import { Activity } from '../../src/retained-ui.ts'
import { flushScheduledTasks } from '../../src/scheduler.ts'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('retained Activity lifecycle', () => {
  it('preserves DOM identity and state while disconnecting and reconnecting effects', () => {
    const modeSource = source(0)
    const countSource = source(0)
    let setMode!: ReturnType<typeof createCompiledState<'visible' | 'hidden'>>['set']
    let setCount!: ReturnType<typeof createCompiledState<number>>['set']
    const effects: string[] = []

    const Child = () => {
      const scope = createCompiledScope()
      const count = createCompiledState(scope, countSource, 0)
      setCount = count.set
      useLayoutEffect(() => {
        effects.push(`connect:${count.get()}`)
        return () => effects.push(`disconnect:${count.get()}`)
      }, [])
      return compiledRoot(scope, () =>
        h('output', { 'data-count': true }, binding(scope, countSource, count.get)),
      )
    }

    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(() => {
      const scope = createCompiledScope()
      const mode = createCompiledState<'visible' | 'hidden'>(scope, modeSource, 'visible')
      setMode = mode.set
      return compiledRoot(scope, () =>
        Activity({
          mode: binding(scope, modeSource, mode.get),
          children: () => h(Child, null),
        }),
      )
    }, host).dispose

    const output = host.querySelector<HTMLOutputElement>('[data-count]')!
    expect(effects).toEqual(['connect:0'])

    setMode('hidden')
    expect(host.querySelector('[data-count]')).toBe(output)
    expect(output.style.display).toBe('none')
    expect(effects).toEqual(['connect:0', 'disconnect:0'])

    setCount(1)
    expect(output.textContent).toBe('0')
    flushScheduledTasks()
    expect(output.textContent).toBe('1')
    expect(output.style.display).toBe('none')
    expect(effects).toEqual(['connect:0', 'disconnect:0'])

    setMode('visible')
    expect(host.querySelector('[data-count]')).toBe(output)
    expect(output.style.display).toBe('')
    expect(output.textContent).toBe('1')
    expect(effects).toEqual(['connect:0', 'disconnect:0', 'connect:1'])
  })

  it('detaches text-only content while hidden and restores the same text node', () => {
    const modeSource = source(0)
    const labelSource = source(1)
    let setMode!: ReturnType<typeof createCompiledState<'visible' | 'hidden'>>['set']
    let setLabel!: ReturnType<typeof createCompiledState<string>>['set']
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(() => {
      const scope = createCompiledScope()
      const mode = createCompiledState<'visible' | 'hidden'>(scope, modeSource, 'visible')
      const label = createCompiledState(scope, labelSource, 'first')
      setMode = mode.set
      setLabel = label.set
      return compiledRoot(scope, () =>
        Activity({
          mode: binding(scope, modeSource, mode.get),
          children: () => binding(scope, labelSource, label.get),
        }),
      )
    }, host).dispose

    const textNode = [...host.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!
    expect(textNode.textContent).toBe('first')
    setMode('hidden')
    expect(host.textContent).toBe('')

    setLabel('second')
    flushScheduledTasks()
    expect(textNode.textContent).toBe('second')
    expect(host.textContent).toBe('')

    setMode('visible')
    expect([...host.childNodes]).toContain(textNode)
    expect(host.textContent).toBe('second')
  })

  it('keeps a hidden nested Activity disconnected when its parent is restored', () => {
    const outerSource = source(0)
    const innerSource = source(1)
    let setOuter!: ReturnType<typeof createCompiledState<'visible' | 'hidden'>>['set']
    let setInner!: ReturnType<typeof createCompiledState<'visible' | 'hidden'>>['set']
    const effects: string[] = []
    const Child = () => {
      const scope = createCompiledScope()
      useLayoutEffect(() => {
        effects.push('connect')
        return () => effects.push('disconnect')
      }, [])
      return compiledRoot(scope, () => h('p', null, 'nested'))
    }

    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(() => {
      const scope = createCompiledScope()
      const outer = createCompiledState<'visible' | 'hidden'>(scope, outerSource, 'visible')
      const inner = createCompiledState<'visible' | 'hidden'>(scope, innerSource, 'visible')
      setOuter = outer.set
      setInner = inner.set
      return compiledRoot(scope, () =>
        Activity({
          mode: binding(scope, outerSource, outer.get),
          children: () =>
            Activity({
              mode: binding(scope, innerSource, inner.get),
              children: () => h(Child, null),
            }),
        }),
      )
    }, host).dispose

    expect(effects).toEqual(['connect'])
    setInner('hidden')
    expect(effects).toEqual(['connect', 'disconnect'])
    setOuter('hidden')
    setOuter('visible')
    expect(effects).toEqual(['connect', 'disconnect'])
    setInner('visible')
    expect(effects).toEqual(['connect', 'disconnect', 'connect'])

    setOuter('hidden')
    expect(effects).toEqual(['connect', 'disconnect', 'connect', 'disconnect'])
    setInner('hidden')
    setOuter('visible')
    expect(host.querySelector('p')?.style.display).toBe('none')
    expect(effects).toEqual(['connect', 'disconnect', 'connect', 'disconnect'])
  })

  it('unsubscribes an external store when its initial consistency check throws', () => {
    const listeners = new Set<() => void>()
    let snapshotReads = 0
    const Child = () => {
      const scope = createCompiledScope()
      createCompiledExternalStore(
        scope,
        source(0),
        (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        () => {
          snapshotReads += 1
          if (snapshotReads === 2) throw new Error('snapshot failed')
          return snapshotReads
        },
      )
      return compiledRoot(scope, () => h('p', null, 'store'))
    }

    const host = document.createElement('div')
    document.body.append(host)
    expect(() =>
      mountCompiled(() => {
        const scope = createCompiledScope()
        return compiledRoot(scope, () =>
          Activity({ mode: 'visible', children: () => h(Child, null) }),
        )
      }, host),
    ).toThrow('snapshot failed')
    expect(snapshotReads).toBe(2)
    expect(listeners.size).toBe(0)
  })
})
