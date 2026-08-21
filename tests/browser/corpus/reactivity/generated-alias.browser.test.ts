import { describe, expect, it } from 'vitest'
import { mountAliasCounter } from '../../generated/alias-counter.ts'

describe('Rust-generated alias reactivity corpus', () => {
  it('propagates state through aliases into stable DOM bindings', () => {
    const host = document.createElement('div')
    const component = mountAliasCounter(host)
    const element = component.element

    expect(host.firstChild).toBe(element)
    expect(element.textContent?.trim()).toBe('2')
    expect(element.getAttribute('data-count')).toBe('1')

    element.click()

    expect(host.firstChild).toBe(element)
    expect(element.textContent?.trim()).toBe('4')
    expect(element.getAttribute('data-count')).toBe('2')
    expect(component.trace).toEqual([
      'derived:direct',
      'derived:alias',
      'derived:doubled',
      'attribute:data-count',
      'text',
    ])

    component.trace.length = 0
    component.batch(() => {
      component.setCount((previous) => previous + 1)
      component.setCount((previous) => previous + 2)
    })

    expect(host.firstChild).toBe(element)
    expect(element.textContent?.trim()).toBe('10')
    expect(element.getAttribute('data-count')).toBe('5')
    expect(component.trace).toEqual([
      'derived:direct',
      'derived:alias',
      'derived:doubled',
      'attribute:data-count',
      'text',
    ])

    component.trace.length = 0
    component.dispose()
    element.click()

    expect(element.textContent?.trim()).toBe('10')
    expect(element.getAttribute('data-count')).toBe('5')
    expect(component.trace).toEqual([])
  })
})
