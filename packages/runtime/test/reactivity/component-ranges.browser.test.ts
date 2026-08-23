import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { describe, expect, it } from 'vitest'

import {
  binding,
  choose,
  compiledRoot,
  createCompiledScope,
  createCompiledState,
  dispatch,
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
      scope[0](childSource, () => {
        childUpdates += 1
      })
      return compiledRoot(scope, () => h('span', null, 'child'))
    }

    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () => h('section', null, h(Child, null)))
    }, host)

    mounted.dispose()
    expect(() => setChild(1)).toThrow('cannot update state after disposal')

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
        scope[0](valueSource, () => (updates += 1))
        return compiledRoot(scope, () => [
          h('span', null, 'staged'),
          { type: 'foreign-element' } as never,
        ])
      }, host),
    ).toThrow(/unsupported compiled child/i)

    expect(() => setValue(1)).toThrow('cannot update state after disposal')
    expect(updates).toBe(0)
    expect(host.childNodes).toHaveLength(1)
    expect(host.firstChild).toBe(previous)
  })

  it('rejects mounting the same component result twice', () => {
    const scope = createCompiledScope()
    const component = compiledRoot(scope, () => h('span', null, 'once'))
    const firstHost = document.createElement('div')
    const secondHost = document.createElement('div')

    component[1](firstHost, null)

    expect(() => component[1](secondHost, null)).toThrow(/already mounted/i)
    expect(firstHost.textContent).toBe('once')
    expect(secondHost.childNodes).toHaveLength(0)
    scope[3]()
  })

  it('retains a selected branch while its own bindings update surgically', async () => {
    const modeSource = source(0)
    let setMode!: ReturnType<typeof createCompiledState<string>>['set']
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const mode = createCompiledState(scope, modeSource, 'first')
      setMode = mode.set
      return compiledRoot(scope, () =>
        choose(
          scope,
          modeSource,
          'truthy',
          () => mode.get() === 'other',
          () => h('p', null, 'other'),
          () =>
            h(
              'section',
              { 'data-mode': binding(scope, modeSource, mode.get) },
              binding(scope, modeSource, mode.get),
            ),
        ),
      )
    }, host)
    const section = host.querySelector('section')!
    const text = requireSingleDirectText(section)

    const aligned = await captureMutations(host, () => setMode('second'))
    expect(host.querySelector('section')).toBe(section)
    expect(section.textContent).toBe('second')
    expect(() =>
      assertMutationEnvelope(
        aligned.records,
        [
          { type: 'attributes', target: section, attributeName: 'data-mode' },
          { type: 'characterData', target: text },
        ],
        'retained choice branch',
      ),
    ).not.toThrow()

    await captureMutations(host, () => setMode('other'))
    expect(host.querySelector('section')).toBeNull()
    expect(host.querySelector('p')?.textContent).toBe('other')
    mounted.dispose()
  })

  it('retains the current choice when replacement ref attachment fails', () => {
    const visibleSource = source(0)
    let showBroken!: () => void
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const broken = createCompiledState(scope, visibleSource, false)
      showBroken = () => broken.set(true)
      return compiledRoot(scope, () =>
        choose(
          scope,
          visibleSource,
          'truthy',
          broken.get,
          () =>
            h('button', {
              ref: () => {
                throw new Error('choice ref failed')
              },
            }),
          () => h('p', null, 'stable'),
        ),
      )
    }, host)
    const stable = host.querySelector('p')

    expect(showBroken).toThrow('choice ref failed')
    expect(host.querySelector('p')).toBe(stable)
    expect(host.textContent).toBe('stable')
    mounted.dispose()
  })

  it('retains matching dispatched identity and remounts when the key changes', async () => {
    const keySource = source(0)
    const labelSource = source(1)
    let setKey!: ReturnType<typeof createCompiledState<string>>['set']
    let setLabel!: ReturnType<typeof createCompiledState<string>>['set']
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const key = createCompiledState(scope, keySource, 'first')
      const label = createCompiledState(scope, labelSource, 'one')
      setKey = key.set
      setLabel = label.set
      return compiledRoot(scope, () =>
        dispatch(
          scope,
          keySource,
          () => 'section',
          key.get,
          () => h('section', { 'data-label': binding(scope, labelSource, label.get) }),
        ),
      )
    }, host)
    const first = host.querySelector('section')!

    const retained = await captureMutations(host, () => setLabel('two'))
    expect(host.querySelector('section')).toBe(first)
    expect(first.getAttribute('data-label')).toBe('two')
    expect(() =>
      assertMutationEnvelope(
        retained.records,
        [{ type: 'attributes', target: first, attributeName: 'data-label' }],
        'stable dispatch identity',
      ),
    ).not.toThrow()

    const replaced = await captureMutations(host, () => setKey('second'))
    const second = host.querySelector('section')!
    expect(second).not.toBe(first)
    expect(second.getAttribute('data-label')).toBe('two')
    expect(() =>
      assertMutationEnvelope(
        replaced.records,
        [{ type: 'childList', target: host }],
        'changed dispatch key',
      ),
    ).not.toThrow()

    mounted.dispose()
  })

  it('replaces and removes reactive event handlers without duplicate listeners', async () => {
    const handlerSource = source(0)
    let setHandler!: ReturnType<
      typeof createCompiledState<((event: Event) => void) | undefined>
    >['set']
    let firstCalls = 0
    let secondCalls = 0
    const host = document.createElement('div')
    const first = () => {
      firstCalls += 1
    }
    const second = () => {
      secondCalls += 1
    }
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const handler = createCompiledState<((event: Event) => void) | undefined>(
        scope,
        handlerSource,
        first,
      )
      setHandler = handler.set
      return compiledRoot(scope, () =>
        h('button', { onClick: binding(scope, handlerSource, handler.get) }, 'action'),
      )
    }, host)
    const button = host.querySelector('button')!

    button.click()
    const replacement = await captureMutations(host, () => setHandler(second))
    button.click()
    const removal = await captureMutations(host, () => setHandler(undefined))
    button.click()

    expect(firstCalls).toBe(1)
    expect(secondCalls).toBe(1)
    expect(replacement.records).toEqual([])
    expect(removal.records).toEqual([])

    mounted.dispose()
    button.click()
    expect(secondCalls).toBe(1)
  })

  it('detaches a static event listener when its component owner disposes', () => {
    let calls = 0
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () =>
        h(
          'button',
          {
            onClick: () => {
              calls += 1
            },
          },
          'action',
        ),
      )
    }, host)
    const button = host.querySelector('button')!

    button.click()
    mounted.dispose()
    button.click()

    expect(calls).toBe(1)
  })
})
