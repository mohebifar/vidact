import { describe, expect, it } from 'vitest'
import { Fragment, h, mount, useRef, useState } from '@vidact/runtime'

describe('direct DOM compatibility runtime', () => {
  it('flattens array children without constructing a virtual tree', () => {
    const list = h(
      'ul',
      null,
      [1, 2, 3].map((value) => h('li', { 'data-value': value }, value)),
    )

    expect(list).toBeInstanceOf(HTMLUListElement)
    expect([...list.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      '1',
      '2',
      '3',
    ])
  })

  it('reruns a mounted component when a functional state setter changes an array', () => {
    const host = document.createElement('div')

    function List(): Node {
      const [items, setItems] = useState([1])
      return h(
        'button',
        { onClick: () => setItems((current) => [...current, current.length + 1]) },
        items.map((item) => h('span', null, item)),
      )
    }

    const mounted = mount(List, host)
    const firstRoot = host.firstChild
    host.querySelector('button')?.click()

    expect(host.textContent).toBe('12')
    expect(host.firstChild).not.toBe(firstRoot)

    mounted.dispose()
    expect(host.childNodes).toHaveLength(0)
  })

  it('keeps a ref cell stable across compatibility-runtime rerenders', () => {
    const host = document.createElement('div')
    const seen: Array<{ current: number }> = []

    function Counter(): Node {
      const [count, setCount] = useState(0)
      const ref = useRef(count)
      seen.push(ref)
      return h('button', { onClick: () => setCount(count + 1) }, count)
    }

    const mounted = mount(Counter, host)
    host.querySelector('button')?.click()

    expect(seen).toHaveLength(2)
    expect(seen[1]).toBe(seen[0])
    mounted.dispose()
  })

  it('maps React double-click handlers to the native dblclick event', () => {
    let calls = 0
    const button = h('button', { onDoubleClick: () => { calls += 1 } }, 'Edit')

    button.dispatchEvent(new MouseEvent('dblclick'))

    expect(calls).toBe(1)
  })

  it('fails loudly when render-phase state updates never stabilize', () => {
    const host = document.createElement('div')

    function Loop(): Node {
      const [value, setValue] = useState(0)
      setValue(value + 1)
      return h('span', null, value)
    }

    expect(() => mount(Loop, host)).toThrow(/did not stabilize/)
  })

  it('removes every node produced by a root fragment on disposal', () => {
    const host = document.createElement('div')
    const mounted = mount(
      () => h(Fragment, null, h('span', null, 'one'), h('span', null, 'two')),
      host,
    )

    expect(host.childNodes).toHaveLength(2)
    mounted.dispose()

    expect(host.childNodes).toHaveLength(0)
  })
})
