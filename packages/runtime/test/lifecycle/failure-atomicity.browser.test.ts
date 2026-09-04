import { startMutationCapture } from '@vidact/test-support'
import { describe, expect, it } from 'vitest'

import {
  binding,
  compiledRoot,
  createCompiledScope,
  createCompiledState,
  h,
  mountCompiled,
  source,
} from '../../src/index.ts'

describe('compiled publication atomicity', () => {
  it('restores a controlled multiple select after a later publication fails', () => {
    const tag = `vidact-select-failure-${crypto.randomUUID()}`
    customElements.define(
      tag,
      class extends HTMLElement {
        set value(next: string) {
          if (next === 'broken') throw new Error('select publication failed')
        }
      },
    )

    const modeSource = source(0)
    const failureSource = source(1)
    let publishFailure!: () => void
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const mode = createCompiledState(scope, modeSource, true)
      const failure = createCompiledState(scope, failureSource, false)
      publishFailure = () =>
        scope[2](() => {
          mode.set(false)
          failure.set(true)
        })
      const select = h(
        'select',
        {
          multiple: binding(scope, modeSource, mode.get),
          value: binding(scope, modeSource, () => (mode.get() ? ['a', 'c'] : 'b')),
        },
        h('option', { value: 'a' }, 'A'),
        h('option', { value: 'b' }, 'B'),
        h('option', { value: 'c' }, 'C'),
      )
      const throwing = h(tag, {
        value: binding(scope, failureSource, () => (failure.get() ? 'broken' : 'ready')),
      })
      return compiledRoot(scope, () => h('div', null, select, throwing))
    }, host)
    const select = host.querySelector('select')!
    const options = [...select.options]

    expect(select.multiple).toBe(true)
    expect([...select.selectedOptions].map((option) => option.value)).toEqual(['a', 'c'])
    expect(() => publishFailure()).toThrow('select publication failed')
    expect(select.multiple).toBe(true)
    expect([...select.selectedOptions].map((option) => option.value)).toEqual(['a', 'c'])
    expect([...select.options]).toEqual(options)
    mounted.dispose()
  })

  it('publishes no earlier text binding when a later computation throws', () => {
    const valueSource = source(0)
    let setValue!: ReturnType<typeof createCompiledState<number>>['set']
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const value = createCompiledState(scope, valueSource, 1)
      setValue = value.set
      const first = h('span', { 'data-first': true }, binding(scope, valueSource, value.get))
      const second = h(
        'span',
        { 'data-second': true },
        binding(scope, valueSource, () => {
          const next = value.get()
          if (next === 2) throw new Error('derived render failed')
          return next * 10
        }),
      )
      return compiledRoot(scope, () => h('div', null, first, second))
    }, host)

    const mutations = startMutationCapture(host)
    expect(() => setValue(2)).toThrow('derived render failed')
    expect(mutations.stop()).toEqual([])
    expect(host.querySelector('[data-first]')?.textContent).toBe('1')
    expect(host.querySelector('[data-second]')?.textContent).toBe('10')

    setValue(3)
    expect(host.querySelector('[data-first]')?.textContent).toBe('3')
    expect(host.querySelector('[data-second]')?.textContent).toBe('30')
    mounted.dispose()
  })

  it('rolls back earlier writes when a later property setter throws during commit', () => {
    const tag = `vidact-throwing-${crypto.randomUUID()}`
    customElements.define(
      tag,
      class extends HTMLElement {
        #value = ''

        get value(): string {
          return this.#value
        }

        set value(next: string) {
          if (next === 'broken') {
            this.setAttribute('data-partial', 'yes')
            throw new Error('property setter failed')
          }
          this.#value = next
          this.removeAttribute('data-partial')
          this.setAttribute('data-value', next)
        }
      },
    )

    const valueSource = source(0)
    let setValue!: ReturnType<typeof createCompiledState<string>>['set']
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const value = createCompiledState(scope, valueSource, 'ready')
      setValue = value.set
      const text = h('span', null, binding(scope, valueSource, value.get))
      const throwing = h(tag, { value: binding(scope, valueSource, value.get) })
      return compiledRoot(scope, () => h('div', null, text, throwing))
    }, host)
    const element = host.querySelector<HTMLElement>(tag)!

    expect(() => setValue('broken')).toThrow('property setter failed')
    expect(host.querySelector('span')?.textContent).toBe('ready')
    expect(element.getAttribute('data-value')).toBe('ready')
    expect(element.hasAttribute('data-partial')).toBe(false)

    setValue('recovered')
    expect(host.querySelector('span')?.textContent).toBe('recovered')
    expect(element.getAttribute('data-value')).toBe('recovered')
    mounted.dispose()
  })

  it('does not publish an opaque raw subtree before a failing property setter', () => {
    const tag = `vidact-raw-failure-${crypto.randomUUID()}`
    const childTag = `vidact-staged-child-${crypto.randomUUID()}`
    let childConstructions = 0
    customElements.define(
      childTag,
      class extends HTMLElement {
        constructor() {
          super()
          childConstructions += 1
        }
      },
    )
    customElements.define(
      tag,
      class extends HTMLElement {
        set value(next: string) {
          if (next === 'broken') throw new Error('raw HTML publication failed')
        }
      },
    )

    const valueSource = source(0)
    let setValue!: ReturnType<typeof createCompiledState<string>>['set']
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const value = createCompiledState(scope, valueSource, 'ready')
      setValue = value.set
      const raw = h('section', {
        'data-raw': true,
        dangerouslySetInnerHTML: binding(scope, valueSource, () => ({
          __html:
            value.get() === 'ready'
              ? '<strong>ready</strong>'
              : `<${childTag}>${value.get()}</${childTag}>`,
        })),
      })
      const throwing = h(tag, { value: binding(scope, valueSource, value.get) })
      return compiledRoot(scope, () => h('div', null, raw, throwing))
    }, host)
    const raw = host.querySelector<HTMLElement>('[data-raw]')!
    const retainedChild = raw.firstElementChild
    const mutations = startMutationCapture(raw)

    expect(() => setValue('broken')).toThrow('raw HTML publication failed')
    expect(mutations.stop()).toEqual([])
    expect(raw.firstElementChild).toBe(retainedChild)
    expect(raw.textContent).toBe('ready')
    expect(childConstructions).toBe(0)

    setValue('recovered')
    expect(raw.textContent).toBe('recovered')
    expect(raw.querySelector(childTag)).not.toBeNull()
    expect(childConstructions).toBe(1)
    mounted.dispose()
  })

  it('restores raw node identity when a later raw publication throws', () => {
    const childTag = `vidact-rollback-child-${crypto.randomUUID()}`
    let constructions = 0
    let connections = 0
    let disconnections = 0
    customElements.define(
      childTag,
      class extends HTMLElement {
        constructor() {
          super()
          constructions += 1
        }

        connectedCallback() {
          connections += 1
        }

        disconnectedCallback() {
          disconnections += 1
        }
      },
    )

    const valueSource = source(0)
    let setValue!: ReturnType<typeof createCompiledState<string>>['set']
    const host = document.createElement('div')
    document.body.append(host)
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const value = createCompiledState(scope, valueSource, 'ready')
      setValue = value.set
      return compiledRoot(scope, () =>
        h(
          'main',
          null,
          h('section', {
            'data-first-raw': true,
            dangerouslySetInnerHTML: binding(scope, valueSource, () => ({
              __html:
                value.get() === 'ready'
                  ? '<strong>ready</strong>'
                  : `<${childTag}>broken</${childTag}>`,
            })),
          }),
          h('section', {
            'data-second-raw': true,
            dangerouslySetInnerHTML: binding(scope, valueSource, () => ({
              __html: `<em>${value.get()}</em>`,
            })),
          }),
        ),
      )
    }, host)
    const first = host.querySelector<HTMLElement>('[data-first-raw]')!
    const second = host.querySelector<HTMLElement>('[data-second-raw]')!
    const retainedFirstChild = first.firstChild
    const retainedSecondChild = second.firstChild
    const replaceSecond = second.replaceChildren.bind(second)
    let shouldThrow = true
    second.replaceChildren = (...nodes) => {
      if (shouldThrow) {
        shouldThrow = false
        throw new Error('later raw publication failed')
      }
      replaceSecond(...nodes)
    }

    expect(() => setValue('broken')).toThrow('later raw publication failed')
    expect(first.firstChild).toBe(retainedFirstChild)
    expect(second.firstChild).toBe(retainedSecondChild)
    expect(first.textContent).toBe('ready')
    expect(second.textContent).toBe('ready')
    expect({ constructions, connections, disconnections }).toEqual({
      constructions: 1,
      connections: 1,
      disconnections: 1,
    })
    mounted.dispose()
    host.remove()
  })

  it('treats nullish reactive raw HTML as a no-op and rejects invalid shapes atomically', () => {
    const valueSource = source(0)
    let setValue!: ReturnType<typeof createCompiledState<unknown>>['set']
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const value = createCompiledState<unknown>(scope, valueSource, {
        __html: '<strong>retained</strong>',
      })
      setValue = value.set
      return compiledRoot(scope, () =>
        h('section', {
          'data-raw': true,
          dangerouslySetInnerHTML: binding(scope, valueSource, value.get),
        }),
      )
    }, host)
    const raw = host.querySelector<HTMLElement>('[data-raw]')!
    const retainedChild = raw.firstElementChild

    const nullishMutations = startMutationCapture(raw)
    setValue({ __html: null })
    expect(nullishMutations.stop()).toEqual([])
    expect(raw.firstElementChild).toBe(retainedChild)

    const invalidMutations = startMutationCapture(raw)
    expect(() => setValue({ html: '<em>invalid</em>' })).toThrow(/must be in the form/i)
    expect(invalidMutations.stop()).toEqual([])
    expect(raw.firstElementChild).toBe(retainedChild)

    setValue({ __html: '' })
    expect(raw.childNodes).toHaveLength(0)
    mounted.dispose()
  })

  it('revalidates a reactive script type at publication time', () => {
    const valueSource = source(0)
    let setValue!: ReturnType<
      typeof createCompiledState<{ readonly type: string; readonly html: string }>
    >['set']
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const value = createCompiledState(scope, valueSource, {
        type: 'application/json',
        html: '{"ready":true}',
      })
      setValue = value.set
      return compiledRoot(scope, () =>
        h('script', {
          type: binding(scope, valueSource, () => value.get().type),
          dangerouslySetInnerHTML: binding(scope, valueSource, () => ({
            __html: value.get().html,
          })),
        }),
      )
    }, host)
    const script = host.querySelector('script')!
    const retainedText = script.firstChild
    const mutations = startMutationCapture(script, {
      attributes: false,
      characterData: false,
      childList: true,
      subtree: true,
    })

    expect(() => setValue({ type: 'module', html: 'globalThis.compromised = true' })).toThrow(
      /executable <script>/i,
    )
    expect(mutations.stop()).toEqual([])
    expect(script.type).toBe('application/json')
    expect(script.firstChild).toBe(retainedText)
    expect(script.textContent).toBe('{"ready":true}')
    mounted.dispose()
  })
})
