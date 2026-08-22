import { captureMutations, startMutationCapture } from '@vidact/test-support'
import { describe, expect, it } from 'vitest'

import { createKeyedList } from '../../src/index.ts'

interface Todo {
  id: number
  label: string
}

describe('keyed array corpus', () => {
  it('reorders, inserts, removes, and updates keyed records without replacing them', () => {
    const host = document.createElement('div')
    const disposed: number[] = []
    const list = createKeyedList<Todo, number>(host, {
      key: (todo) => todo.id,
      render: (todo) => {
        const node = document.createElement('span')
        node.dataset.key = String(todo.id)
        node.textContent = todo.label
        return {
          nodes: [node],
          update: (next) => {
            node.textContent = next.label
          },
          dispose: () => disposed.push(todo.id),
        }
      },
    })

    list.update([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ])
    const originalTwo = host.querySelector('[data-key="2"]')

    list.update([
      { id: 2, label: 'TWO' },
      { id: 3, label: 'three' },
    ])

    expect([...host.querySelectorAll('span')].map((node) => node.dataset.key)).toEqual(['2', '3'])
    expect(host.querySelector('[data-key="2"]')).toBe(originalTwo)
    expect(originalTwo?.textContent).toBe('TWO')
    expect(disposed).toEqual([1])
  })

  it('keeps multi-node records contiguous and rejects duplicate keys atomically', () => {
    const host = document.createElement('div')
    const list = createKeyedList<Todo, number>(host, {
      key: (todo) => todo.id,
      render: (todo) => [
        document.createTextNode(`[${todo.id}]`),
        document.createTextNode(todo.label),
      ],
    })

    list.update([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ])
    list.update([
      { id: 2, label: 'two' },
      { id: 1, label: 'one' },
    ])
    const beforeDuplicate = host.textContent
    const mutations = startMutationCapture(host)

    expect(host.textContent).toBe('[2]two[1]one')
    expect(() =>
      list.update([
        { id: 2, label: 'two' },
        { id: 2, label: 'duplicate' },
      ]),
    ).toThrow(/duplicate key/i)
    expect(mutations.stop()).toEqual([])
    expect(host.textContent).toBe(beforeDuplicate)
  })

  it('does not move DOM records when key order is unchanged', async () => {
    const host = document.createElement('div')
    const list = createKeyedList<Todo, number>(host, {
      key: (todo) => todo.id,
      render: (todo) => document.createTextNode(todo.label),
    })
    const values = [
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]
    list.update(values)
    const { records } = await captureMutations(host, () => list.update(values))

    expect(records).toEqual([])
  })

  it('finishes removing and disposing records before rethrowing cleanup errors', () => {
    const host = document.createElement('div')
    const disposed: number[] = []
    const list = createKeyedList<Todo, number>(host, {
      key: (todo) => todo.id,
      render: (todo) => ({
        nodes: [document.createTextNode(todo.label)],
        dispose: () => {
          disposed.push(todo.id)
          if (todo.id === 1) throw new Error('cleanup failed')
        },
      }),
    })
    list.update([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ])

    expect(() => list.update([])).toThrow('cleanup failed')

    expect(host.textContent).toBe('')
    expect(disposed).toEqual([1, 2])
    expect(() => list.update([{ id: 3, label: 'three' }])).not.toThrow()
    expect(host.textContent).toBe('three')
  })
})
