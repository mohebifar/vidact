import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
  startMutationCapture,
} from '@vidact/test-support'
import { describe, expect, it } from 'vitest'

import {
  binding,
  combineSources,
  compiledEvent,
  compiledRoot,
  createCompiledProp,
  createCompiledScope,
  createCompiledState,
  type DirectComponent,
  Fragment,
  h,
  keyed,
  mountCompiled,
  source,
  when,
} from '../../src/index.ts'

interface Item {
  readonly id: number
  readonly label: string
}

describe('compiled DOM corpus', () => {
  it('updates scalar, branch, and keyed parts without rerunning the component', async () => {
    const countSource = source(0)
    const itemsSource = source(1)
    let setCount!: ReturnType<typeof createCompiledState<number>>['set']
    let setItems!: ReturnType<typeof createCompiledState<readonly Item[]>>['set']
    let componentRuns = 0
    const second = { id: 2, label: 'two' }

    const Component = () => {
      componentRuns += 1
      const scope = createCompiledScope()
      const count = createCompiledState(scope, countSource, 0)
      const items = createCompiledState<readonly Item[]>(scope, itemsSource, [
        { id: 1, label: 'one' },
        second,
      ])
      setCount = count.set
      setItems = items.set

      return compiledRoot(scope, () =>
        h(
          'section',
          null,
          h('strong', { 'data-count': true }, binding(scope, countSource, count.get)),
          when(
            scope,
            countSource,
            () => count.get() > 0,
            () => h('p', null, 'visible'),
          ),
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
                  { 'data-id': item.get().id },
                  binding(itemScope, source(0), () => item.get().label),
                ),
            ),
          ),
        ),
      )
    }

    const host = document.createElement('div')
    const mounted = mountCompiled(Component, host)
    const root = host.firstChild
    const untouched = host.querySelector('[data-id="2"]')
    const section = host.querySelector('section')!
    const countText = requireSingleDirectText(host.querySelector('[data-count]')!)

    const countCapture = await captureMutations(host, () => setCount(1))
    const first = host.querySelector('[data-id="1"]')!
    const itemText = requireSingleDirectText(first)
    const itemsCapture = await captureMutations(host, () => {
      setItems((items) => [{ ...items[0]!, label: 'ONE' }, items[1]!])
    })

    expect(componentRuns).toBe(1)
    expect(host.firstChild).toBe(root)
    expect(host.querySelector('[data-count]')?.textContent).toBe('1')
    expect(host.querySelector('p')?.textContent).toBe('visible')
    expect(host.querySelector('[data-id="1"]')?.textContent).toBe('ONE')
    expect(host.querySelector('[data-id="2"]')).toBe(untouched)
    expect(() =>
      assertMutationEnvelope(
        countCapture.records,
        [
          { type: 'characterData', target: countText },
          { type: 'childList', target: section },
        ],
        'compiled scalar and branch update',
      ),
    ).not.toThrow()
    expect(() =>
      assertMutationEnvelope(
        itemsCapture.records,
        [{ type: 'characterData', target: itemText }],
        'compiled keyed item update',
      ),
    ).not.toThrow()
    expect(itemsCapture.records).toHaveLength(1)

    mounted.dispose()
    expect(host.childNodes).toHaveLength(0)
  })

  it('rejects duplicate keys before changing the current DOM', () => {
    const itemsSource = source(0)
    let setItems!: ReturnType<typeof createCompiledState<readonly Item[]>>['set']
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const items = createCompiledState<readonly Item[]>(scope, itemsSource, [
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
    }, host)
    const before = host.innerHTML
    const mutations = startMutationCapture(host)

    expect(() =>
      setItems([
        { id: 2, label: 'two' },
        { id: 2, label: 'duplicate' },
      ]),
    ).toThrow(/duplicate key/i)
    expect(mutations.stop()).toEqual([])
    expect(host.innerHTML).toBe(before)

    mounted.dispose()
  })

  it('keeps the previous keyed DOM when rendering a replacement throws', () => {
    const itemsSource = source(0)
    let setItems!: ReturnType<typeof createCompiledState<readonly Item[]>>['set']
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const items = createCompiledState<readonly Item[]>(scope, itemsSource, [
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
            (item, _index, itemScope) => {
              if (item.get().label === 'broken') throw new Error('render failed')
              return h(
                'li',
                null,
                binding(itemScope, source(0), () => item.get().label),
              )
            },
          ),
        ),
      )
    }, host)
    const before = host.innerHTML

    expect(() =>
      setItems([
        { id: 1, label: 'ONE' },
        { id: 3, label: 'broken' },
      ]),
    ).toThrow('render failed')
    expect(host.innerHTML).toBe(before)

    mounted.dispose()
  })

  it('evaluates lazy state once and disposes fragment roots as one component', () => {
    let initializations = 0
    let setValue!: ReturnType<typeof createCompiledState<number>>['set']
    const valueSource = source(0)
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const value = createCompiledState(scope, valueSource, () => {
        initializations += 1
        return 1
      })
      setValue = value.set
      return compiledRoot(scope, () =>
        h(
          Fragment,
          null,
          h('span', null, binding(scope, valueSource, value.get)),
          h('span', null, 'tail'),
        ),
      )
    }, host)

    expect(initializations).toBe(1)
    setValue(2)
    expect(host.textContent).toBe('2tail')
    mounted.dispose()
    expect(host.childNodes).toHaveLength(0)
  })

  it('batches every synchronous state write from one compiled event', () => {
    const firstSource = source(0)
    const secondSource = source(1)
    let updaterRuns = 0
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const first = createCompiledState(scope, firstSource, 0)
      const second = createCompiledState(scope, secondSource, 0)
      scope[0](combineSources(firstSource, secondSource), () => {
        updaterRuns += 1
      })
      return compiledRoot(scope, () =>
        h(
          'button',
          {
            onClick: compiledEvent(scope, () => {
              first.set(1)
              second.set(2)
            }),
          },
          'update',
        ),
      )
    }, host)

    host.querySelector('button')?.click()

    expect(updaterRuns).toBe(1)
    mounted.dispose()
  })

  it('fails loudly when updater feedback cycles across compiled scopes', () => {
    const valueSource = source(0)
    const firstScope = createCompiledScope()
    const secondScope = createCompiledScope()
    const first = createCompiledState(firstScope, valueSource, 0)
    const second = createCompiledState(secondScope, valueSource, 0)
    firstScope[0](valueSource, () => second.set(second.get() + 1))
    secondScope[0](valueSource, () => first.set(first.get() + 1))

    expect(() => first.set(1)).toThrow(/did not stabilize/i)

    firstScope[3]()
    secondScope[3]()
  })

  it('updates same-key records through item slots without replacing their DOM', async () => {
    const itemsSource = source(0)
    const prefixSource = source(1)
    const itemSource = source(0)
    const indexSource = source(1)
    let setItems!: ReturnType<typeof createCompiledState<readonly Item[]>>['set']
    let setPrefix!: ReturnType<typeof createCompiledState<string>>['set']
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const items = createCompiledState<readonly Item[]>(scope, itemsSource, [
        { id: 1, label: 'one' },
        { id: 2, label: 'two' },
      ])
      const prefix = createCompiledState(scope, prefixSource, 'row')
      setItems = items.set
      setPrefix = prefix.set
      return compiledRoot(scope, () =>
        h(
          'ul',
          null,
          keyed(
            scope,
            itemsSource,
            items.get,
            (item) => item.id,
            (item, index, itemScope) =>
              h(
                'li',
                {
                  'data-id': binding(itemScope, itemSource, () => item.get().id),
                  className: binding(
                    scope,
                    prefixSource,
                    () => `${prefix.get()}-${item.get().id}`,
                    itemScope,
                    itemSource,
                  ),
                },
                binding(
                  itemScope,
                  combineSources(itemSource, indexSource),
                  () => `${index.get()}:${item.get().label}`,
                ),
              ),
          ),
        ),
      )
    }, host)
    const first = host.querySelector('[data-id="1"]')
    const second = host.querySelector('[data-id="2"]')
    const list = host.querySelector('ul')!

    const reorderCapture = await captureMutations(host, () =>
      setItems([
        { id: 2, label: 'TWO' },
        { id: 1, label: 'ONE' },
      ]),
    )

    expect(host.querySelector('[data-id="1"]')).toBe(first)
    expect(host.querySelector('[data-id="2"]')).toBe(second)
    expect(host.querySelectorAll('li')[0]).toBe(second)
    expect(host.querySelectorAll('li')[1]).toBe(first)
    expect(host.textContent).toBe('0:TWO1:ONE')
    expect(() =>
      assertMutationEnvelope(
        reorderCapture.records,
        [
          { type: 'characterData', within: list },
          { type: 'childList', target: list },
        ],
        'compiled keyed reorder',
      ),
    ).not.toThrow()

    const prefixCapture = await captureMutations(host, () => setPrefix('item'))
    expect(first?.className).toBe('item-1')
    expect(second?.className).toBe('item-2')
    expect(prefixCapture.records).toHaveLength(2)
    expect(() =>
      assertMutationEnvelope(
        prefixCapture.records,
        [
          { type: 'attributes', target: first!, attributeName: 'class' },
          { type: 'attributes', target: second!, attributeName: 'class' },
        ],
        'compiled shared attribute update',
      ),
    ).not.toThrow()

    mounted.dispose()
  })

  it('mounts a compiler-owned block through props exactly once', () => {
    const itemsSource = source(0)
    const itemSource = source(0)
    const rowsSource = source(0)
    let setItems!: ReturnType<typeof createCompiledState<readonly Item[]>>['set']
    const host = document.createElement('div')
    const List: DirectComponent = (props) => {
      const scope = createCompiledScope()
      const rows = createCompiledProp(scope, rowsSource, props.rows)
      return compiledRoot(scope, () => h('ul', null, binding(scope, rowsSource, rows.get)))
    }
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const items = createCompiledState<readonly Item[]>(scope, itemsSource, [
        { id: 1, label: 'one' },
      ])
      setItems = items.set
      const rows = keyed(
        scope,
        itemsSource,
        items.get,
        (item) => item.id,
        (item, _index, itemScope) =>
          h(
            'li',
            null,
            binding(itemScope, itemSource, () => item.get().label),
          ),
      )
      return compiledRoot(scope, () => h(List, { rows }))
    }, host)
    const row = host.querySelector('li')

    setItems([{ id: 1, label: 'ONE' }])
    expect(host.querySelector('li')).toBe(row)
    expect(row?.textContent).toBe('ONE')

    const duplicateHost = document.createElement('div')
    const scope = createCompiledScope()
    const duplicate = keyed(
      scope,
      itemsSource,
      () => [{ id: 1, label: 'one' }],
      (item) => item.id,
      (item) => h('li', null, item.get().label),
    )
    duplicate[1](duplicateHost, null)
    expect(() => duplicate[1](duplicateHost, null)).toThrow(/already mounted/i)
    scope[3]()

    mounted.dispose()
  })

  it('disposes a removed keyed record item scope', () => {
    const itemsSource = source(0)
    const itemSource = source(0)
    let setItems!: ReturnType<typeof createCompiledState<readonly Item[]>>['set']
    let removedItem!: ReturnType<typeof createCompiledState<Item>>
    let removedUpdaterRuns = 0
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const items = createCompiledState<readonly Item[]>(scope, itemsSource, [
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
            (item, _index, itemScope) => {
              if (item.get().id === 1) {
                removedItem = item
                itemScope[0](itemSource, () => {
                  removedUpdaterRuns += 1
                })
              }
              return h(
                'li',
                null,
                binding(itemScope, itemSource, () => item.get().label),
              )
            },
          ),
        ),
      )
    }, host)

    setItems([{ id: 2, label: 'two' }])
    expect(() => removedItem.set({ id: 1, label: 'ONE' })).toThrow(
      'cannot update state after disposal',
    )

    expect(removedUpdaterRuns).toBe(0)
    expect(host.textContent).toBe('two')
    mounted.dispose()
  })

  it('bridges parent bindings into owned child prop slots and disposes them with the branch', async () => {
    const labelSource = source(0)
    const visibleSource = source(1)
    const childLabelSource = source(0)
    let setLabel!: ReturnType<typeof createCompiledState<string>>['set']
    let setVisible!: ReturnType<typeof createCompiledState<boolean>>['set']
    let childUpdates = 0
    let childRefCleanups = 0
    const host = document.createElement('div')
    const Child: DirectComponent = (props) => {
      const scope = createCompiledScope()
      const label = createCompiledProp(scope, childLabelSource, props.label)
      scope[0](childLabelSource, () => {
        childUpdates += 1
      })
      return compiledRoot(scope, () =>
        h(
          'strong',
          {
            ref: () => () => {
              childRefCleanups += 1
            },
          },
          binding(scope, childLabelSource, label.get),
        ),
      )
    }
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const label = createCompiledState(scope, labelSource, 'one')
      const visible = createCompiledState(scope, visibleSource, true)
      setLabel = label.set
      setVisible = visible.set
      return compiledRoot(scope, () =>
        h(
          'section',
          null,
          when(scope, visibleSource, visible.get, () =>
            h(Child, {
              label: binding(scope, labelSource, label.get),
            }),
          ),
        ),
      )
    }, host)
    const section = host.querySelector('section')!
    const child = host.querySelector('strong')!
    const childText = requireSingleDirectText(child)

    const labelCapture = await captureMutations(host, () => setLabel('two'))
    expect(host.querySelector('strong')?.textContent).toBe('two')
    expect(childUpdates).toBe(1)
    expect(host.querySelector('strong')).toBe(child)
    expect(labelCapture.records).toHaveLength(1)
    expect(() =>
      assertMutationEnvelope(
        labelCapture.records,
        [{ type: 'characterData', target: childText }],
        'compiled child prop update',
      ),
    ).not.toThrow()

    const branchCapture = await captureMutations(host, () => setVisible(false))
    setLabel('three')
    expect(host.querySelector('strong')).toBeNull()
    expect(childUpdates).toBe(1)
    expect(childRefCleanups).toBe(1)
    expect(() =>
      assertMutationEnvelope(
        branchCapture.records,
        [
          { type: 'childList', within: child },
          { type: 'childList', target: section },
        ],
        'compiled child branch removal',
      ),
    ).not.toThrow()

    mounted.dispose()
  })

  it('applies destructuring-style defaults when a reactive prop becomes undefined', () => {
    const parentSource = source(0)
    const childSource = source(0)
    let setLabel!: ReturnType<typeof createCompiledState<string | undefined>>['set']
    const host = document.createElement('div')
    const Child: DirectComponent = (props) => {
      const scope = createCompiledScope()
      const label = createCompiledProp(
        scope,
        childSource,
        props.label as string | undefined,
        () => 'fallback',
      )
      return compiledRoot(scope, () => h('p', null, binding(scope, childSource, label.get)))
    }
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const label = createCompiledState<string | undefined>(scope, parentSource, undefined)
      setLabel = label.set
      return compiledRoot(scope, () =>
        h(Child, {
          label: binding(scope, parentSource, label.get),
        }),
      )
    }, host)

    expect(host.textContent).toBe('fallback')
    setLabel('provided')
    expect(host.textContent).toBe('provided')
    setLabel(undefined)
    expect(host.textContent).toBe('fallback')

    mounted.dispose()
  })

  it('flushes multiple parent prop bridges as one child transaction', () => {
    const firstParentSource = source(0)
    const secondParentSource = source(1)
    const firstChildSource = source(0)
    const secondChildSource = source(1)
    let setBoth!: (first: string, second: string) => void
    const observed: string[] = []
    const host = document.createElement('div')
    const Child: DirectComponent = (props) => {
      const scope = createCompiledScope()
      const first = createCompiledProp(scope, firstChildSource, props.first)
      const second = createCompiledProp(scope, secondChildSource, props.second)
      scope[0](combineSources(firstChildSource, secondChildSource), () => {
        observed.push(`${first.get()}:${second.get()}`)
      })
      return compiledRoot(scope, () =>
        h(
          'p',
          null,
          binding(
            scope,
            combineSources(firstChildSource, secondChildSource),
            () => `${first.get()}:${second.get()}`,
          ),
        ),
      )
    }
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const first = createCompiledState(scope, firstParentSource, 'one')
      const second = createCompiledState(scope, secondParentSource, 'two')
      setBoth = (nextFirst, nextSecond) =>
        scope[2](() => {
          first.set(nextFirst)
          second.set(nextSecond)
        })
      return compiledRoot(scope, () =>
        h(Child, {
          first: binding(scope, firstParentSource, first.get),
          second: binding(scope, secondParentSource, second.get),
        }),
      )
    }, host)

    setBoth('ONE', 'TWO')

    expect(observed).toEqual(['ONE:TWO'])
    expect(host.textContent).toBe('ONE:TWO')
    mounted.dispose()
  })

  it('disposes scopes created by a child that throws during construction', () => {
    const labelSource = source(0)
    const visibleSource = source(1)
    const childLabelSource = source(0)
    let setLabel!: ReturnType<typeof createCompiledState<string>>['set']
    let setVisible!: ReturnType<typeof createCompiledState<boolean>>['set']
    let leakedUpdates = 0
    const host = document.createElement('div')
    const BrokenChild: DirectComponent = (props) => {
      const scope = createCompiledScope()
      createCompiledProp(scope, childLabelSource, props.label)
      scope[0](childLabelSource, () => {
        leakedUpdates += 1
      })
      return compiledRoot(scope, () => {
        throw new Error('child failed')
      })
    }
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const label = createCompiledState(scope, labelSource, 'one')
      const visible = createCompiledState(scope, visibleSource, false)
      setLabel = label.set
      setVisible = visible.set
      return compiledRoot(scope, () =>
        h(
          'section',
          null,
          when(scope, visibleSource, visible.get, () =>
            h(BrokenChild, { label: binding(scope, labelSource, label.get) }),
          ),
        ),
      )
    }, host)

    expect(() => setVisible(true)).toThrow('child failed')
    setLabel('two')

    expect(leakedUpdates).toBe(0)
    expect(host.querySelector('section')?.textContent).toBe('')
    mounted.dispose()
  })

  it('updates reactive arrays, nodes, and empty values inside stable binding ranges', () => {
    const valueSource = source(0)
    let setValue!: ReturnType<typeof createCompiledState<unknown>>['set']
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const value = createCompiledState<unknown>(scope, valueSource, 0)
      setValue = value.set
      return compiledRoot(scope, () =>
        h(
          'div',
          null,
          h('i', null, 'before'),
          binding(scope, valueSource, value.get),
          h('i', null, 'after'),
        ),
      )
    }, host)

    setValue(['a', 0, null, false, ['b']])
    expect(host.textContent).toBe('beforea0bafter')

    const node = document.createElement('em')
    node.textContent = 'node'
    setValue(node)
    expect(host.querySelector('em')).toBe(node)
    expect(host.textContent).toBe('beforenodeafter')

    for (const invalid of [
      { type: 'foreign-element' },
      () => 'invalid',
      Symbol('invalid'),
      Promise.resolve('invalid'),
    ]) {
      const mutations = startMutationCapture(host)
      expect(() => setValue([node, invalid])).toThrow(/unsupported compiled child/i)
      expect(mutations.stop()).toEqual([])
      expect(host.querySelector('em')).toBe(node)
      expect(host.textContent).toBe('beforenodeafter')
    }

    setValue(null)
    expect(host.textContent).toBe('beforeafter')

    expect(() => setValue({ type: 'foreign-element' })).toThrow(/unsupported compiled child/i)
    expect(host.textContent).toBe('beforeafter')
    setValue(['recovered'])
    expect(host.textContent).toBe('beforerecoveredafter')

    mounted.dispose()
  })

  it('attaches refs on committed keyed records before propagating cleanup errors', () => {
    const itemsSource = source(0)
    let setItems!: ReturnType<typeof createCompiledState<readonly number[]>>['set']
    let secondAttachments = 0
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const items = createCompiledState<readonly number[]>(scope, itemsSource, [1])
      setItems = items.set
      return compiledRoot(scope, () =>
        h(
          'div',
          null,
          keyed(
            scope,
            itemsSource,
            items.get,
            (item) => item,
            (item) =>
              h(
                'button',
                {
                  'data-id': item.get(),
                  ref:
                    item.get() === 1
                      ? () => () => {
                          throw new Error('row cleanup failed')
                        }
                      : (element: Element | null) => {
                          if (element !== null) secondAttachments += 1
                        },
                },
                item.get(),
              ),
          ),
        ),
      )
    }, host)

    expect(() => setItems([2])).toThrow('row cleanup failed')

    expect(host.querySelector('[data-id="2"]')?.textContent).toBe('2')
    expect(secondAttachments).toBe(1)
    mounted.dispose()
  })

  it('attaches object and callback refs and cleans them with the compiled owner', () => {
    const objectRef: { current: HTMLInputElement | null } = { current: null }
    let attached: HTMLButtonElement | null = null
    let callbackCleanups = 0
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () =>
        h(
          'section',
          null,
          h('input', { ref: objectRef }),
          h(
            'button',
            {
              ref: (node: HTMLButtonElement) => {
                attached = node
                return () => {
                  callbackCleanups += 1
                }
              },
            },
            'action',
          ),
        ),
      )
    }, host)

    expect(objectRef.current).toBe(host.querySelector('input'))
    expect(attached).toBe(host.querySelector('button'))

    mounted.dispose()
    expect(objectRef.current).toBeNull()
    expect(callbackCleanups).toBe(1)
  })

  it('retains the previous reactive ref when the next attachment throws', () => {
    const refSource = source(0)
    let setBroken!: ReturnType<typeof createCompiledState<boolean>>['set']
    let previousCleanups = 0
    const previousRef = (): (() => void) => () => {
      previousCleanups += 1
    }
    const brokenRef = (): never => {
      throw new Error('reactive ref failed')
    }
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const broken = createCompiledState(scope, refSource, false)
      setBroken = broken.set
      return compiledRoot(scope, () =>
        h('input', {
          ref: binding(scope, refSource, () => (broken.get() ? brokenRef : previousRef)),
        }),
      )
    }, host)

    expect(() => setBroken(true)).toThrow('reactive ref failed')
    expect(previousCleanups).toBe(0)
    expect(host.querySelector('input')).not.toBeNull()

    mounted.dispose()
    expect(previousCleanups).toBe(1)
  })

  it('removes the compiled root even when ref cleanup throws', () => {
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () =>
        h(
          'button',
          {
            ref: () => () => {
              throw new Error('cleanup failed')
            },
          },
          'action',
        ),
      )
    }, host)

    expect(() => mounted.dispose()).toThrow('cleanup failed')
    expect(host.childNodes).toHaveLength(0)
  })
})
