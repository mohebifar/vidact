import { Fragment, h } from '@vidact/runtime'
import { describe, expect, it } from 'vitest'

describe('direct DOM construction', () => {
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

  it('maps React double-click handlers to the native dblclick event', () => {
    let calls = 0
    const button = h(
      'button',
      {
        onDoubleClick: () => {
          calls += 1
        },
      },
      'Edit',
    )

    button.dispatchEvent(new MouseEvent('dblclick'))

    expect(calls).toBe(1)
  })

  it('registers React capture handlers in the native capture phase', () => {
    const calls: string[] = []
    const child = h(
      'button',
      {
        onClick: () => calls.push('child'),
      },
      'Child',
    )
    const parent = h('div', { onClickCapture: () => calls.push('parent') }, child)

    child.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(parent.contains(child)).toBe(true)
    expect(calls).toEqual(['parent', 'child'])
  })

  it('constructs root fragments without a compatibility mount', () => {
    const fragment = h(Fragment, null, h('span', null, 'one'), h('span', null, 'two'))

    expect(fragment.childNodes).toHaveLength(2)
    expect(fragment.textContent).toBe('onetwo')
  })
})
