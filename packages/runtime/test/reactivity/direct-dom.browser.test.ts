import {
  binding,
  createCompiledScope,
  createCompiledState,
  Fragment,
  h,
  source,
} from '@vidact/runtime'
import { jsxs } from '@vidact/runtime/jsx-runtime'
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

  it('preserves the existing flat children contract for function components', () => {
    const first = h('span', null, 'first')
    const second = h('span', null, 'second')
    let received: unknown
    const result = jsxs(
      (props) => {
        received = props.children
        return h('div', null, ...(props.children as Node[]))
      },
      { children: [first, second] },
    )

    expect(received).toEqual([first, second])
    expect((result as HTMLElement).textContent).toBe('firstsecond')
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

  it('rejects invalid static event props at the event boundary', () => {
    expect(() => h('button', { onClick: 'not a handler' })).toThrow(/event prop onClick/i)
  })

  it('rejects scalar controlled values for multiple selects', () => {
    expect(() =>
      h('select', { multiple: true, value: 'a' }, h('option', { value: 'a' }, 'A')),
    ).toThrow(/select multiple.*array/i)
  })

  it('rolls back a reactive select mode when its controlled value is invalid', () => {
    const scope = createCompiledScope()
    const multipleSource = source(0)
    const multiple = createCompiledState(scope, multipleSource, false)
    const select = h(
      'select',
      { multiple: binding(scope, multipleSource, multiple.get), value: 'a' },
      h('option', { value: 'a' }, 'A'),
    )

    expect(() => multiple.set(true)).toThrow(/select multiple.*array/i)
    expect(select.multiple).toBe(false)
    expect(select.value).toBe('a')
    scope.dispose()
  })

  it('constructs root fragments without a compatibility mount', () => {
    const fragment = h(Fragment, null, h('span', null, 'one'), h('span', null, 'two'))

    expect(fragment.childNodes).toHaveLength(2)
    expect(fragment.textContent).toBe('onetwo')
  })

  it('parses raw HTML in the host element context', () => {
    const table = h('table', {
      dangerouslySetInnerHTML: {
        __html: '<tbody><tr><td data-cell="yes">contextual</td></tr></tbody>',
      },
    })
    const template = h('template', {
      dangerouslySetInnerHTML: { __html: '<strong data-template="yes">template</strong>' },
    })

    expect(table.querySelector('[data-cell="yes"]')?.textContent).toBe('contextual')
    expect(template.content.querySelector('[data-template="yes"]')?.textContent).toBe('template')
  })

  it('matches React raw HTML validation at the direct runtime boundary', () => {
    expect(() => h('div', { dangerouslySetInnerHTML: '<b>invalid</b>' })).toThrow(
      /must be in the form/i,
    )
    expect(() => h('div', { dangerouslySetInnerHTML: {} })).toThrow(/must be in the form/i)
    expect(() =>
      h('div', { dangerouslySetInnerHTML: { __html: '<b>raw</b>' } }, 'owned child'),
    ).toThrow(/only set one of.*children.*dangerouslySetInnerHTML/i)
    expect(() => h('img', { dangerouslySetInnerHTML: { __html: 'invalid' } })).toThrow(
      /void element/i,
    )
    expect(() => h('textarea', { dangerouslySetInnerHTML: { __html: 'invalid' } })).toThrow(
      /does not make sense on <textarea>/i,
    )

    const nullish = h('div', { dangerouslySetInnerHTML: { __html: null } }, 'owned child')
    expect(nullish.textContent).toBe('owned child')
    const getter = h('div', {
      dangerouslySetInnerHTML: {
        get __html() {
          return '<i>getter</i>'
        },
      },
    })
    expect(getter.textContent).toBe('getter')
    const inherited = h('div', {
      dangerouslySetInnerHTML: Object.create({ __html: '<u>inherited</u>' }),
    })
    expect(inherited.textContent).toBe('inherited')
    expect(() => h('img', { dangerouslySetInnerHTML: { __html: null } })).toThrow(/void element/i)
    expect(() => h('textarea', { dangerouslySetInnerHTML: { __html: null } })).toThrow(
      /does not make sense on <textarea>/i,
    )
  })

  it('supports non-executable data scripts and rejects executable raw scripts', () => {
    const data = h('script', {
      type: 'application/ld+json',
      dangerouslySetInnerHTML: { __html: '{"name":"Vidact"}' },
    })

    expect(data.textContent).toBe('{"name":"Vidact"}')
    expect(() =>
      h('script', { dangerouslySetInnerHTML: { __html: 'globalThis.compromised = true' } }),
    ).toThrow(/executable <script>/i)
  })

  it('does not execute script elements parsed inside an opaque raw subtree', () => {
    const marker = `__vidactRawHtml${crypto.randomUUID().replaceAll('-', '')}`
    const root = h('div', {
      dangerouslySetInnerHTML: {
        __html: `<script>globalThis[${JSON.stringify(marker)}] = true</script><span>safe</span>`,
      },
    })

    document.body.append(root)

    expect(Reflect.get(globalThis, marker)).toBeUndefined()
    expect(root.querySelector('span')?.textContent).toBe('safe')
    root.remove()
  })

  it('passes TrustedHTML objects to the browser without string coercion when available', () => {
    const factory = (
      globalThis as typeof globalThis & {
        trustedTypes?: {
          createPolicy(
            name: string,
            rules: { createHTML(value: string): string },
          ): {
            createHTML(value: string): unknown
          }
        }
      }
    ).trustedTypes
    if (factory === undefined) return

    const policy = factory.createPolicy(`vidact-test-${crypto.randomUUID()}`, {
      createHTML: (value) => value,
    })
    const trusted = policy.createHTML('<mark data-trusted="yes">trusted</mark>')
    const root = h('div', { dangerouslySetInnerHTML: { __html: trusted } })

    expect(root.querySelector('[data-trusted="yes"]')?.textContent).toBe('trusted')
  })

  it('does not reconstruct a custom-element host while parsing its raw children', () => {
    const tag = `vidact-raw-host-${crypto.randomUUID()}`
    let constructions = 0
    customElements.define(
      tag,
      class extends HTMLElement {
        constructor() {
          super()
          constructions += 1
        }
      },
    )

    const root = h(tag, {
      dangerouslySetInnerHTML: { __html: '<span data-custom-child>child</span>' },
    }) as HTMLElement

    expect(constructions).toBe(1)
    expect(root.querySelector('[data-custom-child]')?.textContent).toBe('child')
  })
})
