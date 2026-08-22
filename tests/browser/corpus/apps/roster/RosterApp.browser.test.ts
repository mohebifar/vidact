import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { RosterApp } from './RosterApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled RosterApp', () => {
  it('updates, reorders, and appends JSX-array props without remounting owned DOM', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(RosterApp, host).dispose

    const root = host.querySelector<HTMLElement>('.roster-app')!
    const list = host.querySelector<HTMLUListElement>('.roster')!
    const draft = host.querySelector<HTMLInputElement>('.draft')!
    const ada = host.querySelector<HTMLElement>('[data-member-id="ada"]')!
    const grace = host.querySelector<HTMLElement>('[data-member-id="grace"]')!
    const adaScore = ada.querySelector<HTMLElement>('.member-score')!
    const adaScoreText = requireSingleDirectText(adaScore)
    draft.value = 'preserve me'

    const promoted = await captureMutations(host, () => {
      host.querySelector<HTMLButtonElement>('[data-promote="ada"]')!.click()
    })

    expect(host.querySelector('[data-member-id="ada"]')).toBe(ada)
    expect(host.querySelector('[data-member-id="grace"]')).toBe(grace)
    expect(adaScore.textContent).toBe('2')
    expect(promoted.records).toHaveLength(1)
    expect(() =>
      assertMutationEnvelope(
        promoted.records,
        [{ type: 'characterData', target: adaScoreText }],
        'RosterApp promotion',
      ),
    ).not.toThrow()

    const reversed = await captureMutations(host, () => {
      host.querySelector<HTMLButtonElement>('[data-action="reverse"]')!.click()
    })

    expect(host.querySelectorAll('[data-member-id]')[0]).toBe(grace)
    expect(host.querySelectorAll('[data-member-id]')[1]).toBe(ada)
    expect(host.querySelector('.roster')).toBe(list)
    expect(host.querySelector<HTMLInputElement>('.draft')).toBe(draft)
    expect(draft.value).toBe('preserve me')
    expect(() =>
      assertMutationEnvelope(
        reversed.records,
        [
          { type: 'characterData', within: list },
          { type: 'childList', target: list },
        ],
        'RosterApp reorder',
      ),
    ).not.toThrow()

    const added = await captureMutations(host, () => {
      host.querySelector<HTMLButtonElement>('[data-action="add"]')!.click()
    })

    expect(host.querySelector('.roster-app')).toBe(root)
    expect(host.querySelector('.roster')).toBe(list)
    expect(host.querySelectorAll('[data-member-id]')[0]).toBe(grace)
    expect(host.querySelectorAll('[data-member-id]')[1]).toBe(ada)
    expect(host.querySelector('[data-member-id="new-1"]')).not.toBeNull()
    expect(list.dataset.memberCount).toBe('3')
    expect(draft.value).toBe('preserve me')
    expect(added.records).toHaveLength(2)
    expect(() =>
      assertMutationEnvelope(
        added.records,
        [
          { type: 'attributes', target: list, attributeName: 'data-member-count' },
          { type: 'childList', target: list },
        ],
        'RosterApp append',
      ),
    ).not.toThrow()
  })
})
