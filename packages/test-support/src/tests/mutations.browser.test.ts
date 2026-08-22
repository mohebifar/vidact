import { describe, expect, it } from 'vitest'

import {
  assertMutationEnvelope,
  captureMutations,
  describeMutations,
  requireSingleDirectText,
  startMutationCapture,
} from '../mutations.ts'

describe('DOM mutation test helpers', () => {
  it('captures subtree mutations and preserves the action result', async () => {
    const host = document.createElement('div')
    const text = document.createTextNode('before')
    const element = document.createElement('span')
    host.append(text, element)

    const capture = await captureMutations(host, () => {
      text.data = 'after'
      element.setAttribute('data-state', 'ready')
      element.append(document.createElement('strong'))
      return 42
    })

    expect(capture.result).toBe(42)
    expect(requireSingleDirectText(host)).toBe(text)
    expect(capture.records.map((record) => record.type)).toEqual([
      'characterData',
      'attributes',
      'childList',
    ])
    expect(() =>
      assertMutationEnvelope(capture.records, [
        { type: 'characterData', target: text },
        { type: 'attributes', target: element, attributeName: 'data-state' },
        { type: 'childList', target: element },
      ]),
    ).not.toThrow()
  })

  it('waits for asynchronous actions before draining records', async () => {
    const host = document.createElement('div')
    const text = document.createTextNode('before')
    host.append(text)

    const capture = await captureMutations(host, async () => {
      await Promise.resolve()
      text.data = 'after'
    })

    expect(capture.records).toHaveLength(1)
    expect(capture.records[0]?.target).toBe(text)
  })

  it('normalizes disabled mutation types and runs a custom settle step', async () => {
    const host = document.createElement('div')
    const text = document.createTextNode('before')
    host.append(text)

    const capture = await captureMutations(host, () => undefined, {
      observe: { attributes: false, childList: false },
      settle: () => {
        text.data = 'settled'
      },
    })

    expect(capture.records).toHaveLength(1)
    expect(capture.records[0]?.type).toBe('characterData')
  })

  it('reports unexpected mutations with readable targets', async () => {
    const host = document.createElement('section')
    const text = document.createTextNode('before')
    host.append(text)
    const { records } = await captureMutations(host, () => {
      text.data = 'after'
    })

    expect(describeMutations(records)).toEqual(['characterData #text("after") (was "before")'])
    expect(() => assertMutationEnvelope(records, [], 'scalar update')).toThrow(
      /scalar update.*characterData #text\("after"\)/s,
    )
  })

  it('allows mutations anywhere within an owned subtree', async () => {
    const host = document.createElement('div')
    const owned = document.createElement('section')
    const nested = document.createElement('span')
    const foreign = document.createElement('aside')
    owned.append(nested)
    host.append(owned, foreign)

    const { records } = await captureMutations(host, () => {
      nested.setAttribute('title', 'owned')
      foreign.setAttribute('title', 'foreign')
    })

    expect(() => assertMutationEnvelope(records, [{ type: 'attributes', within: owned }])).toThrow(
      /<aside>/,
    )
  })

  it('records mutations around actions that throw', () => {
    const host = document.createElement('div')
    const recorder = startMutationCapture(host)

    expect(() => {
      host.append(document.createElement('span'))
      throw new Error('failed update')
    }).toThrow('failed update')

    expect(recorder.stop()).toHaveLength(1)
    expect(recorder.stop()).toHaveLength(1)
  })

  it('fails clearly unless exactly one direct text leaf exists', () => {
    const element = document.createElement('div')
    element.append(document.createComment('vidact:binding'))

    expect(() => requireSingleDirectText(element, 'compiled binding')).toThrow(
      'compiled binding must contain exactly one direct text node; found 0',
    )

    element.append('one', 'two')
    expect(() => requireSingleDirectText(element, 'compiled binding')).toThrow(
      'compiled binding must contain exactly one direct text node; found 2',
    )
  })
})
