import { describe, expect, it } from 'vitest'
import {
  binding,
  combineSources,
  compiledEvent,
  compiledRoot,
  createCompiledScope,
  createCompiledState,
  type DirectComponent,
  Fragment,
  h,
  keyed,
  mountCompiled,
  source,
  when,
} from '@vidact/runtime'

interface Item {
  readonly id: number
  readonly label: string
}

describe('compiled DOM corpus', () => {
  it('updates scalar, branch, and keyed parts without rerunning the component', () => {
    const countSource = source(0)
    const itemsSource = source(1)
    let setCount!: ReturnType<typeof createCompiledState<number>>['set']
    let setItems!: ReturnType<typeof createCompiledState<readonly Item[]>>['set']
    let componentRuns = 0
    const second = { id: 2, label: 'two' }

    const Component = (): Node => {
      componentRuns += 1
      const scope = createCompiledScope()
      const count = createCompiledState(scope, countSource, 0)
      const items = createCompiledState<readonly Item[]>(scope, itemsSource, [
        { id: 1, label: 'one' },
        second,
      ])
      setCount = count.set
      setItems = items.set

      return compiledRoot(scope, () => h(
        'section',
        null,
        h('strong', { 'data-count': true }, binding(scope, countSource, count.get)),
        when(scope, countSource, () => count.get() > 0, () => h('p', null, 'visible')),
        h(
          'ul',
          null,
          keyed(
            scope,
            itemsSource,
            items.get,
            (item) => item.id,
            (item, _index, itemScope) => h(
              'li',
              { 'data-id': item.get().id },
              binding(itemScope, source(0), () => item.get().label),
            ),
          ),
        ),
      ))
    }

    const host = document.createElement('div')
    const mounted = mountCompiled(Component, host)
    const root = host.firstChild
    const untouched = host.querySelector('[data-id="2"]')

    setCount(1)
    setItems((items) => [{ ...items[0]!, label: 'ONE' }, items[1]!])

    expect(componentRuns).toBe(1)
    expect(host.firstChild).toBe(root)
    expect(host.querySelector('[data-count]')?.textContent).toBe('1')
    expect(host.querySelector('p')?.textContent).toBe('visible')
    expect(host.querySelector('[data-id="1"]')?.textContent).toBe('ONE')
    expect(host.querySelector('[data-id="2"]')).toBe(untouched)

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
      return compiledRoot(scope, () => h(
        'ul',
        null,
        keyed(
          scope,
          itemsSource,
          items.get,
          (item) => item.id,
          (item, _index, itemScope) => h(
            'li',
            null,
            binding(itemScope, source(0), () => item.get().label),
          ),
        ),
      ))
    }, host)
    const before = host.innerHTML

    expect(() => setItems([
      { id: 2, label: 'two' },
      { id: 2, label: 'duplicate' },
    ])).toThrow(/duplicate key/i)
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
      return compiledRoot(scope, () => h('ul', null, keyed(
        scope,
        itemsSource,
        items.get,
        (item) => item.id,
        (item, _index, itemScope) => {
          if (item.get().label === 'broken') throw new Error('render failed')
          return h('li', null, binding(itemScope, source(0), () => item.get().label))
        },
      )))
    }, host)
    const before = host.innerHTML

    expect(() => setItems([
      { id: 1, label: 'ONE' },
      { id: 3, label: 'broken' },
    ])).toThrow('render failed')
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
      return compiledRoot(scope, () => h(
        Fragment,
        null,
        h('span', null, binding(scope, valueSource, value.get)),
        h('span', null, 'tail'),
      ))
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
      scope.add({
        reads: combineSources(firstSource, secondSource),
        run: () => { updaterRuns += 1 },
      })
      return compiledRoot(scope, () => h('button', {
        onClick: compiledEvent(scope, () => {
          first.set(1)
          second.set(2)
        }),
      }, 'update'))
    }, host)

    host.querySelector('button')?.click()

    expect(updaterRuns).toBe(1)
    mounted.dispose()
  })

  it('updates same-key records through item slots without replacing their DOM', () => {
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
      return compiledRoot(scope, () => h('ul', null, keyed(
        scope,
        itemsSource,
        items.get,
        (item) => item.id,
        (item, index, itemScope) => h(
          'li',
          {
            'data-id': binding(
              itemScope,
              itemSource,
              () => item.get().id,
            ),
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
      )))
    }, host)
    const first = host.querySelector('[data-id="1"]')
    const second = host.querySelector('[data-id="2"]')

    setItems([
      { id: 2, label: 'TWO' },
      { id: 1, label: 'ONE' },
    ])

    expect(host.querySelector('[data-id="1"]')).toBe(first)
    expect(host.querySelector('[data-id="2"]')).toBe(second)
    expect(host.querySelectorAll('li')[0]).toBe(second)
    expect(host.querySelectorAll('li')[1]).toBe(first)
    expect(host.textContent).toBe('0:TWO1:ONE')

    setPrefix('item')
    expect(first?.className).toBe('item-1')
    expect(second?.className).toBe('item-2')

    mounted.dispose()
  })

  it('mounts a compiler-owned block through props exactly once', () => {
    const itemsSource = source(0)
    const itemSource = source(0)
    let setItems!: ReturnType<typeof createCompiledState<readonly Item[]>>['set']
    const host = document.createElement('div')
    const List: DirectComponent = (props): Node => h(
      'ul',
      null,
      props.rows as ReturnType<typeof keyed<Item, number>>,
    )
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
        (item, _index, itemScope) => h(
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
    duplicate.mount(duplicateHost, null)
    expect(() => duplicate.mount(duplicateHost, null)).toThrow(/already mounted/i)
    scope.dispose()

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
      return compiledRoot(scope, () => h('ul', null, keyed(
        scope,
        itemsSource,
        items.get,
        (item) => item.id,
        (item, _index, itemScope) => {
          if (item.get().id === 1) {
            removedItem = item
            itemScope.add({
              reads: itemSource,
              run: () => { removedUpdaterRuns += 1 },
            })
          }
          return h('li', null, binding(itemScope, itemSource, () => item.get().label))
        },
      )))
    }, host)

    setItems([{ id: 2, label: 'two' }])
    removedItem.set({ id: 1, label: 'ONE' })

    expect(removedUpdaterRuns).toBe(0)
    expect(host.textContent).toBe('two')
    mounted.dispose()
  })
})
