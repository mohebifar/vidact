import { captureMutations } from '@vidact/test-support'
import { describe, expect, it } from 'vitest'

import { createIndexedList } from '../../src/index.ts'

interface Row {
  readonly id: string
  readonly label: string
}

describe('indexed array corpus', () => {
  it('retains owners by position while values shift through them', async () => {
    const host = document.createElement('div')
    const list = createIndexedList<Row>(host, {
      render: (row) => {
        const node = document.createElement('span')
        node.dataset.id = row.id
        node.textContent = row.label
        return {
          nodes: [node],
          update: (next) => {
            node.dataset.id = next.id
            node.textContent = next.label
          },
        }
      },
    })

    list.update([
      { id: 'a', label: 'Ada' },
      { id: 'g', label: 'Grace' },
    ])
    const firstOwner = host.querySelectorAll('span')[0]
    const secondOwner = host.querySelectorAll('span')[1]

    const mutations = await captureMutations(host, () =>
      list.update([
        { id: 'n', label: 'New' },
        { id: 'a', label: 'Ada' },
        { id: 'g', label: 'Grace' },
      ]),
    )

    expect(host.querySelectorAll('span')[0]).toBe(firstOwner)
    expect(host.querySelectorAll('span')[1]).toBe(secondOwner)
    expect(firstOwner?.getAttribute('data-id')).toBe('n')
    expect(secondOwner?.getAttribute('data-id')).toBe('a')
    expect(mutations.records.some((record) => record.type === 'childList')).toBe(true)
  })

  it('truncates trailing positional owners without moving retained nodes', () => {
    const host = document.createElement('div')
    const disposed: string[] = []
    const list = createIndexedList<Row>(host, {
      render: (row) => {
        const node = document.createElement('span')
        node.textContent = row.label
        return {
          nodes: [node],
          update: (next) => {
            node.textContent = next.label
          },
          dispose: () => disposed.push(row.id),
        }
      },
    })
    list.update([
      { id: 'a', label: 'Ada' },
      { id: 'g', label: 'Grace' },
    ])
    const firstOwner = host.querySelectorAll('span')[0]

    list.update([{ id: 'g', label: 'Grace' }])

    expect(host.querySelector('span')).toBe(firstOwner)
    expect(host.textContent).toBe('Grace')
    expect(disposed).toEqual(['g'])
  })
})
