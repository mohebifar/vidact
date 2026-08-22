import { describe, expect, it } from 'vitest'

import {
  compiledRoot,
  createCompiledScope,
  createCompiledState,
  h,
  mountCompiled,
  source,
} from '../../src/index.ts'

describe('compiled component ranges', () => {
  it('mounts one element through an owned range without a wrapper element', () => {
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () => h('button', null, 'action'))
    }, host)

    expect(host.children).toHaveLength(1)
    expect(host.firstElementChild?.tagName).toBe('BUTTON')
    expect(host.textContent).toBe('action')

    mounted.dispose()
    expect(host.childNodes).toHaveLength(0)
  })

  it('owns fragments, arrays, scalars, and empty component output', () => {
    const cases = [
      {
        render: () => [h('span', null, 'one'), h('span', null, 'two')],
        text: 'onetwo',
        elements: 2,
      },
      { render: () => ['value', 0, 1n], text: 'value01', elements: 0 },
      { render: () => [null, undefined, false, true], text: '', elements: 0 },
      { render: () => document.createDocumentFragment(), text: '', elements: 0 },
    ] as const

    for (const testCase of cases) {
      const host = document.createElement('div')
      const mounted = mountCompiled(() => {
        const scope = createCompiledScope()
        return compiledRoot(scope, testCase.render)
      }, host)

      expect(host.textContent).toBe(testCase.text)
      expect(host.children).toHaveLength(testCase.elements)
      expect(host.querySelectorAll('[data-vidact-component]')).toHaveLength(0)

      mounted.dispose()
      expect(host.childNodes).toHaveLength(0)
    }
  })

  it('adopts a nested component range and disposes it with its parent', () => {
    const childSource = source(0)
    let setChild!: ReturnType<typeof createCompiledState<number>>['set']
    let childUpdates = 0
    const host = document.createElement('div')

    const Child = () => {
      const scope = createCompiledScope()
      const value = createCompiledState(scope, childSource, 0)
      setChild = value.set
      scope.add({
        reads: childSource,
        run: () => {
          childUpdates += 1
        },
      })
      return compiledRoot(scope, () => h('span', null, 'child'))
    }

    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () => h('section', null, h(Child, null)))
    }, host)

    mounted.dispose()
    setChild(1)

    expect(childUpdates).toBe(0)
    expect(host.childNodes).toHaveLength(0)
  })

  it('leaves the previous host contents intact when ref attachment fails', () => {
    const host = document.createElement('div')
    const previous = document.createElement('p')
    previous.textContent = 'previous'
    host.append(previous)
    let attached = 0
    let cleaned = 0

    expect(() =>
      mountCompiled(() => {
        const scope = createCompiledScope()
        return compiledRoot(scope, () => [
          h('button', {
            ref: () => {
              attached += 1
              return () => {
                cleaned += 1
              }
            },
          }),
          h('input', {
            ref: () => {
              throw new Error('ref attachment failed')
            },
          }),
        ])
      }, host),
    ).toThrow('ref attachment failed')

    expect(attached).toBe(1)
    expect(cleaned).toBe(1)
    expect(host.childNodes).toHaveLength(1)
    expect(host.firstChild).toBe(previous)
    expect(host.textContent).toBe('previous')
  })

  it('disposes a staged component when rendering fails before publication', () => {
    const valueSource = source(0)
    let setValue!: ReturnType<typeof createCompiledState<number>>['set']
    let updates = 0
    const host = document.createElement('div')
    const previous = document.createElement('p')
    previous.textContent = 'previous'
    host.append(previous)

    expect(() =>
      mountCompiled(() => {
        const scope = createCompiledScope()
        const value = createCompiledState(scope, valueSource, 0)
        setValue = value.set
        scope.add({ reads: valueSource, run: () => (updates += 1) })
        return compiledRoot(scope, () => [
          h('span', null, 'staged'),
          { type: 'foreign-element' } as never,
        ])
      }, host),
    ).toThrow(/unsupported compiled child/i)

    setValue(1)
    expect(updates).toBe(0)
    expect(host.childNodes).toHaveLength(1)
    expect(host.firstChild).toBe(previous)
  })

  it('rejects mounting the same component result twice', () => {
    const scope = createCompiledScope()
    const component = compiledRoot(scope, () => h('span', null, 'once'))
    const firstHost = document.createElement('div')
    const secondHost = document.createElement('div')

    component.mount(firstHost, null)

    expect(() => component.mount(secondHost, null)).toThrow(/already mounted/i)
    expect(firstHost.textContent).toBe('once')
    expect(secondHost.childNodes).toHaveLength(0)
    scope.dispose()
  })
})
