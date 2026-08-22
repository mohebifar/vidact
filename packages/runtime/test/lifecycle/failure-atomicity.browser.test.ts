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
})
