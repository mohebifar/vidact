import { describe, expect, it } from 'vitest'
import { mountAliasCounter } from '../../generated/alias-counter.ts'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '../support/mutations.ts'

describe('Rust-generated alias reactivity corpus', () => {
  it('propagates state through aliases into stable DOM bindings', async () => {
    const host = document.createElement('div')
    const component = mountAliasCounter(host)
    const element = component.element
    const text = requireSingleDirectText(element)

    expect(host.firstChild).toBe(element)
    expect(element.textContent?.trim()).toBe('2')
    expect(element.getAttribute('data-count')).toBe('1')

    const clickCapture = await captureMutations(host, () => element.click())

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
    expect(clickCapture.records).toHaveLength(2)
    expect(() => assertMutationEnvelope(clickCapture.records, [
      { type: 'attributes', target: element, attributeName: 'data-count' },
      { type: 'characterData', target: text },
    ], 'generated counter click')).not.toThrow()

    component.trace.length = 0
    const batchCapture = await captureMutations(host, () => component.batch(() => {
      component.setCount((previous) => previous + 1)
      component.setCount((previous) => previous + 2)
    }))

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
    expect(batchCapture.records).toHaveLength(2)
    expect(() => assertMutationEnvelope(batchCapture.records, [
      { type: 'attributes', target: element, attributeName: 'data-count' },
      { type: 'characterData', target: text },
    ], 'generated counter batch')).not.toThrow()

    component.trace.length = 0
    component.dispose()
    const disposedCapture = await captureMutations(host, () => element.click())

    expect(element.textContent?.trim()).toBe('10')
    expect(element.getAttribute('data-count')).toBe('5')
    expect(component.trace).toEqual([])
    expect(disposedCapture.records).toEqual([])
  })
})
