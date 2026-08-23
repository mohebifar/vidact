import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import PortalApp, {
  configurePortalTarget,
  readPortalLayoutTrace,
  resetPortalState,
} from './PortalApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  resetPortalState()
  document.body.replaceChildren()
})

describe('compiled portals', () => {
  it('retains logical context and ownership in a physical container', async () => {
    const host = document.createElement('div')
    const portalHost = document.createElement('aside')
    document.body.append(host, portalHost)
    configurePortalTarget(portalHost)
    dispose = mountCompiled(PortalApp, host, { identifierPrefix: 'portal-' }).dispose

    const initialChild = portalHost.querySelector<HTMLElement>('[data-portal-child]')!
    const theme = portalHost.querySelector<HTMLOutputElement>('[data-portal-theme]')!
    const themeText = requireSingleDirectText(theme)
    const count = portalHost.querySelector<HTMLOutputElement>('[data-portal-count]')!
    let logicalBubbles = 0
    let physicalBubbles = 0
    host.addEventListener('click', () => (logicalBubbles += 1))
    portalHost.addEventListener('click', () => (physicalBubbles += 1))

    expect(initialChild.id).toBe(':portal-r0:')
    expect(theme.textContent).toBe('red')
    expect(readPortalLayoutTrace()).toEqual(['ready'])
    expect(host.querySelector('[data-portal-child]')).toBeNull()

    portalHost.querySelector<HTMLButtonElement>('[data-portal]')!.click()
    expect(count.textContent).toBe('1')
    expect(logicalBubbles).toBe(0)
    expect(physicalBubbles).toBe(1)

    const themed = await captureMutations(portalHost, () =>
      host.querySelector<HTMLButtonElement>('[data-toggle-theme]')!.click(),
    )

    expect(portalHost.querySelector('[data-portal-child]')).toBe(initialChild)
    expect(theme.textContent).toBe('blue')
    expect(count.textContent).toBe('1')
    expect(() =>
      assertMutationEnvelope(
        themed.records,
        [
          { type: 'attributes', target: initialChild, attributeName: 'data-theme' },
          { type: 'attributes', target: theme, attributeName: 'data-portal-theme' },
          { type: 'characterData', target: themeText },
        ],
        'portal context update',
      ),
    ).not.toThrow()

    host.querySelector<HTMLButtonElement>('[data-toggle-portal]')!.click()
    expect(portalHost.querySelector('[data-portal-child]')).toBeNull()

    host.querySelector<HTMLButtonElement>('[data-toggle-portal]')!.click()
    expect(portalHost.querySelector<HTMLElement>('[data-portal-child]')?.id).toBe(':portal-r1:')
    expect(portalHost.querySelector('[data-portal-theme]')?.textContent).toBe('blue')
    expect(portalHost.querySelector('[data-portal-count]')?.textContent).toBe('0')

    dispose()
    dispose = undefined
    expect(portalHost.childNodes).toHaveLength(0)
  })
})
