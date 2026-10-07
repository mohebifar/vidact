import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const root = vi.hoisted(() => ({
  replace: vi.fn<(application: () => unknown) => void>(),
  unmount: vi.fn<() => void>(),
}))

vi.mock('@vidact/runtime/hydrate', () => ({
  createElement: vi.fn<(...arguments_: unknown[]) => unknown>(),
  hydrateRoot: vi.fn<
    () => { mount: () => void; replace: typeof root.replace; unmount: typeof root.unmount }
  >(() => ({ mount: vi.fn<() => void>(), ...root })),
}))

import { hydrateStart } from '../../../../../packages/start/src/client.ts'
import { createRouteManifest, defineFileRoute } from '../../../../../packages/start/src/router.ts'
import {
  encodeStartSnapshot,
  VIDACT_START_PROTOCOL,
  VIDACT_START_SNAPSHOT_MEDIA_TYPE,
} from '../../../../../packages/start/src/snapshot.ts'

const loads = new Map<string, number>()
const manifest = createRouteManifest(
  ['/', '/page', '/other'].map((path) => ({
    id: path,
    path,
    parentId: null,
    load: async () => {
      loads.set(path, (loads.get(path) ?? 0) + 1)
      return { Route: defineFileRoute({ component: () => null }) }
    },
  })),
)

function snapshot(pathname: string): string {
  return encodeStartSnapshot({ protocol: VIDACT_START_PROTOCOL, pathname, loaderData: {} })
}

function snapshotResponse(url: string | URL | Request): Response {
  const pathname = new URL(String(url instanceof Request ? url.url : url)).pathname
  return new Response(snapshot(pathname), {
    headers: { 'content-type': VIDACT_START_SNAPSHOT_MEDIA_TYPE },
  })
}

function link(href: string, attributes: Record<string, string> = {}): HTMLAnchorElement {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.dataset.vidactStartLink = ''
  for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value)
  anchor.append(document.createElement('span'))
  document.body.append(anchor)
  return anchor
}

async function start(fetchNavigation: typeof globalThis.fetch) {
  return hydrateStart({
    manifest,
    root: document.querySelector('#root')!,
    snapshot: snapshot('/'),
    fetch: fetchNavigation,
  })
}

describe('Start prefetching', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    document.body.innerHTML = '<main id="root"></main>'
    loads.clear()
    root.replace.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('reuses a prefetched snapshot for the next navigation to that URL', async () => {
    const fetchNavigation = vi.fn<typeof globalThis.fetch>(async (url) => snapshotResponse(url))
    const client = await start(fetchNavigation)

    await client.prefetch('/page')
    expect(fetchNavigation).toHaveBeenCalledOnce()
    expect(loads.get('/page')).toBe(1)

    await expect(client.navigate('/page#top')).resolves.toBe(true)
    expect(fetchNavigation).toHaveBeenCalledOnce()
    expect(window.location.pathname).toBe('/page')

    // Each prefetch backs one navigation; coming back fetches fresh data.
    await client.navigate('/')
    await client.navigate('/page')
    expect(fetchNavigation).toHaveBeenCalledTimes(3)
    client.unmount()
  })

  it('shares one request between overlapping prefetches and skips the current page', async () => {
    const fetchNavigation = vi.fn<typeof globalThis.fetch>(async (url) => snapshotResponse(url))
    const client = await start(fetchNavigation)

    await Promise.all([client.prefetch('/page'), client.prefetch('/page?')])
    await client.prefetch('/')
    await client.prefetch('/missing')
    expect(fetchNavigation).toHaveBeenCalledOnce()
    client.unmount()
  })

  it('ignores a stale prefetch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const fetchNavigation = vi.fn<typeof globalThis.fetch>(async (url) => snapshotResponse(url))
    const client = await start(fetchNavigation)

    await client.prefetch('/page')
    vi.setSystemTime(Date.now() + 30_001)
    await client.navigate('/page')
    expect(fetchNavigation).toHaveBeenCalledTimes(2)
    client.unmount()
  })

  it('falls back to a fresh request when the prefetch failed', async () => {
    const fetchNavigation = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockImplementation(async (url) => snapshotResponse(url))
    const client = await start(fetchNavigation)

    await client.prefetch('/page')
    await expect(client.navigate('/page')).resolves.toBe(true)
    expect(fetchNavigation).toHaveBeenCalledTimes(2)
    client.unmount()
  })

  it('prefetches links on hover, focus, and press', async () => {
    const fetchNavigation = vi.fn<typeof globalThis.fetch>(async (url) => snapshotResponse(url))
    const client = await start(fetchNavigation)
    const hovered = link('/page')
    const focused = link('/other')

    hovered.firstElementChild!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    hovered.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    expect(fetchNavigation).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(fetchNavigation).toHaveBeenCalledOnce())

    focused.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(fetchNavigation).toHaveBeenCalledTimes(2)

    client.unmount()
    window.history.replaceState({}, '', '/other')
    const pressed = link('/page')
    const fresh = await start(fetchNavigation)
    pressed.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(fetchNavigation).toHaveBeenCalledTimes(3)
    fresh.unmount()
  })

  it('does not prefetch a link again once its navigation starts', async () => {
    const fetchNavigation = vi.fn<typeof globalThis.fetch>(async (url) => snapshotResponse(url))
    const client = await start(fetchNavigation)
    const anchor = link('/page')

    anchor.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    anchor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, cancelable: true }))
    anchor.firstElementChild!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    await vi.waitFor(() => expect(window.location.pathname).toBe('/page'))
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(fetchNavigation).toHaveBeenCalledOnce()
    client.unmount()
  })

  it('cancels a hover that leaves before the delay and honors prefetch none', async () => {
    const fetchNavigation = vi.fn<typeof globalThis.fetch>(async (url) => snapshotResponse(url))
    const client = await start(fetchNavigation)
    const passing = link('/page')
    const optedOut = link('/other', { 'data-vidact-start-prefetch': 'none' })

    passing.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    passing.dispatchEvent(
      new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
    )
    optedOut.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    optedOut.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(fetchNavigation).not.toHaveBeenCalled()
    client.unmount()
  })
})
