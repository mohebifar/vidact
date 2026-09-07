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

const manifest = createRouteManifest(
  ['/', '/page', '/redirected'].map((path) => ({
    id: path,
    path,
    parentId: null,
    load: async () => ({ Route: defineFileRoute({ component: () => null }) }),
  })),
)

function snapshot(pathname: string): string {
  return encodeStartSnapshot({ protocol: VIDACT_START_PROTOCOL, pathname, loaderData: {} })
}

function snapshotResponse(pathname: string): Response {
  return new Response(snapshot(pathname), {
    headers: { 'content-type': VIDACT_START_SNAPSHOT_MEDIA_TYPE },
  })
}

describe('Start fragment navigation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    document.body.innerHTML = '<main id="root"><section id="section"></section></main>'
    root.replace.mockReset()
    root.unmount.mockReset()
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('preserves fragments through push, replace, scroll suppression, and redirects', async () => {
    const section = document.querySelector<HTMLElement>('#section')!
    const scrollIntoView = vi.fn<() => void>()
    section.scrollIntoView = scrollIntoView
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    let responsePath = '/page'
    const client = await hydrateStart({
      manifest,
      root: document.querySelector('#root')!,
      snapshot: snapshot('/'),
      fetch: vi.fn<typeof globalThis.fetch>(async () => snapshotResponse(responsePath)),
    })

    await expect(client.navigate('/page#section')).resolves.toBe(true)
    expect(window.location.pathname).toBe('/page')
    expect(window.location.hash).toBe('#section')
    expect(scrollIntoView).toHaveBeenCalledOnce()

    scrollIntoView.mockClear()
    await client.navigate('/page#section', { scroll: false })
    expect(window.location.hash).toBe('#section')
    expect(scrollIntoView).not.toHaveBeenCalled()

    await client.navigate('/page#missing', { replace: true })
    expect(window.location.hash).toBe('#missing')
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' })

    responsePath = '/redirected'
    await client.navigate('/page#section')
    expect(window.location.pathname).toBe('/redirected')
    expect(window.location.hash).toBe('#section')

    client.unmount()
    expect(root.unmount).toHaveBeenCalledOnce()
  })

  it('leaves same-document hash clicks to the browser', async () => {
    window.history.replaceState({}, '', '/page')
    const fetchNavigation = vi.fn<typeof globalThis.fetch>(async () => snapshotResponse('/page'))
    const client = await hydrateStart({
      manifest,
      root: document.querySelector('#root')!,
      snapshot: snapshot('/page'),
      fetch: fetchNavigation,
    })
    const anchor = document.createElement('a')
    anchor.href = '/page#section'
    anchor.dataset.vidactStartLink = ''
    document.body.append(anchor)
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    anchor.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
    client.unmount()
  })
})
