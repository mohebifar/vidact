import { jsx as serverJsx, type ServerChild } from '@vidact/runtime/framework/server/jsx-runtime'
import { describe, expect, it, vi } from 'vitest'

import {
  createRouteManifest,
  decodeStartSnapshot,
  defineFileRoute,
  VIDACT_START_NAVIGATION_HEADER,
  VIDACT_START_SNAPSHOT_MEDIA_TYPE,
  type RouteManifestEntry,
} from '../src/index.ts'
import { createStartHandler } from '../src/server.ts'

function entry(
  id: string,
  path: string,
  parentId: string | null,
  definition: ReturnType<typeof defineFileRoute>,
): RouteManifestEntry {
  return { id, path, parentId, load: async () => ({ Route: definition }) }
}

describe('Vidact Start server', () => {
  it('renders nested file routes with loader data and a hydration snapshot', async () => {
    const manifest = createRouteManifest([
      entry(
        '__root',
        '/',
        null,
        defineFileRoute({
          component: ({ children }) => serverJsx('main', { children }) as ServerChild,
        }),
      ),
      entry(
        'products/$productId',
        '/products/:productId',
        '__root',
        defineFileRoute({
          loader: ({ params }) => ({ name: params.productId }),
          component: ({ loaderData }) =>
            serverJsx('h1', {
              children: (loaderData as { name: string }).name,
            }) as ServerChild,
        }),
      ),
    ])
    const handler = createStartHandler({
      manifest,
      clientEntry: '/src/client.ts',
    })

    const response = await handler(new Request('https://example.test/products/ridge?currency=usd'))
    const html = await response.text()
    const snapshotPayload = html.match(
      /<script id="vidact-start-snapshot" type="application\/json">(.*?)<\/script>/u,
    )?.[1]

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html).toContain('<main>')
    expect(html).toContain('<h1>')
    expect(html).toContain('ridge')
    expect(html).toContain('id="vidact-start-root"')
    expect(html).toContain('id="vidact-start-snapshot"')
    expect(html).toContain('src="/src/client.ts"')
    expect(html).toContain('vidact-start-v1')
    expect(snapshotPayload).toBeDefined()
    expect(decodeStartSnapshot(snapshotPayload!)).toMatchObject({
      pathname: '/products/ridge?currency=usd',
    })
  })

  it('dispatches server endpoints without running UI loaders', async () => {
    const loader = vi.fn<() => { unused: boolean }>(() => ({ unused: true }))
    const manifest = createRouteManifest([
      entry(
        'api/products',
        '/api/products',
        null,
        defineFileRoute({
          loader,
          server: {
            handlers: {
              POST: ({ request }) => Response.json({ method: request.method }),
            },
          },
        }),
      ),
    ])
    const handler = createStartHandler({ manifest })

    const response = await handler(
      new Request('https://example.test/api/products', { method: 'POST' }),
    )

    await expect(response.json()).resolves.toEqual({ method: 'POST' })
    expect(loader).not.toHaveBeenCalled()

    const unsupported = await handler(new Request('https://example.test/api/products'))
    expect(unsupported.status).toBe(405)
    expect(unsupported.headers.get('allow')).toBe('POST')
  })

  it('returns explicit not-found and method responses', async () => {
    const loader = vi.fn<() => string>(() => 'ready')
    const manifest = createRouteManifest([
      entry('index', '/', null, defineFileRoute({ loader, component: () => 'ready' })),
    ])
    const handler = createStartHandler({ manifest })

    expect((await handler(new Request('https://example.test/missing'))).status).toBe(404)
    const method = await handler(new Request('https://example.test/', { method: 'DELETE' }))
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('GET, HEAD')
    expect(loader).not.toHaveBeenCalled()
  })

  it('removes the body when HEAD falls back to a GET endpoint', async () => {
    const manifest = createRouteManifest([
      entry(
        'health',
        '/health',
        null,
        defineFileRoute({
          server: { handlers: { GET: () => Response.json({ ready: true }) } },
        }),
      ),
    ])
    const response = await createStartHandler({ manifest })(
      new Request('https://example.test/health', { method: 'HEAD' }),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('makes custom-document snapshots safe inside a script element', async () => {
    const manifest = createRouteManifest([
      entry(
        'index',
        '/',
        null,
        defineFileRoute({
          loader: () => '</script><script>globalThis.compromised = true</script>',
          component: () => 'ready',
        }),
      ),
    ])
    const response = await createStartHandler({
      manifest,
      renderDocument: ({ snapshot }) => `<script type="application/json">${snapshot}</script>`,
    })(new Request('https://example.test/'))
    const html = await response.text()

    expect(html).not.toContain('</script><script>')
    expect(html).toContain('\\u003c/script\\u003e')
  })

  it('returns loader snapshots without rendering HTML during client navigation', async () => {
    const component = vi.fn<() => string>(() => 'rendered')
    const manifest = createRouteManifest([
      entry(
        'products/$productId',
        '/products/:productId',
        null,
        defineFileRoute({
          loader: ({ params }) => ({ productId: params.productId }),
          component,
        }),
      ),
    ])
    const response = await createStartHandler({ manifest })(
      new Request('https://example.test/products/bottle?currency=usd', {
        headers: { [VIDACT_START_NAVIGATION_HEADER]: '1' },
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      `${VIDACT_START_SNAPSHOT_MEDIA_TYPE}; charset=utf-8`,
    )
    expect(decodeStartSnapshot(await response.text())).toMatchObject({
      pathname: '/products/bottle?currency=usd',
      loaderData: { 'products/$productId': { productId: 'bottle' } },
    })
    expect(component).not.toHaveBeenCalled()
  })
})
