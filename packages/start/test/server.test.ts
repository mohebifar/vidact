import { jsx as serverJsx, type ServerChild } from '@vidact/runtime/framework/server/jsx-runtime'
import { Suspense, use } from '@vidact/runtime/server'
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

function createForeignRealmResponse(body: BodyInit | null, init: ResponseInit): Response {
  const response = new Response(body, init)
  return new Proxy(response, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
    getPrototypeOf() {
      return null
    },
  })
}

function varyAwareCacheKey(request: Request, response: Response): string {
  const vary = response.headers.get('vary')
  const dimensions = vary
    ?.split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean)
    .map((header) => `${header}:${request.headers.get(header) ?? ''}`)
    .join('|')
  return `${request.url}|${dimensions ?? ''}`
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
    expect(response.headers.get('vary')).toBe(VIDACT_START_NAVIGATION_HEADER)
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

  it('streams the document shell before a delayed application settles', async () => {
    const message = deferred<string>()
    const manifest = createRouteManifest([
      entry(
        'index',
        '/',
        null,
        defineFileRoute({
          component: () =>
            Suspense({
              children: () => serverJsx('strong', { children: use(message.promise) }),
              fallback: () => serverJsx('p', { children: 'loading' }),
            }),
        }),
      ),
    ])
    const response = await createStartHandler({ manifest })(new Request('https://example.test/'))
    const reader = response.body!.getReader()

    const first = await reader.read()
    const shell = new TextDecoder().decode(first.value)
    expect(first.done).toBe(false)
    expect(shell).toContain('<!doctype html>')
    expect(shell).toContain('<div id="vidact-start-root">')
    expect(shell).not.toContain('ready')
    expect(shell).not.toContain('vidact-start-snapshot')

    const applicationRead = reader.read()
    let applicationSettled = false
    void applicationRead.then(() => {
      applicationSettled = true
    })
    await Promise.resolve()
    expect(applicationSettled).toBe(false)

    message.resolve('ready')
    const applicationChunk = await applicationRead
    const html =
      shell + new TextDecoder().decode(applicationChunk.value) + (await readReader(reader))
    expect(html).toContain('<strong>')
    expect(html).toContain('ready')
    expect(html).toContain('id="vidact-start-snapshot"')
    expect(html.indexOf('ready')).toBeLessThan(html.indexOf('vidact-start-snapshot'))
    expectBalancedMarker(html, 'r')
    expectBalancedMarker(html, 'b')
    expectBalancedMarker(html, 'c')
  })

  it('supports streaming custom shells and keeps legacy custom documents buffered', async () => {
    const streamedMessage = deferred<string>()
    const bufferedMessage = deferred<string>()
    const route = (message: ReturnType<typeof deferred<string>>) =>
      createRouteManifest([
        entry(
          'index',
          '/',
          null,
          defineFileRoute({
            component: () =>
              Suspense({
                children: () => serverJsx('strong', { children: use(message.promise) }),
                fallback: () => 'loading',
              }),
          }),
        ),
      ])
    const streaming = await createStartHandler({
      manifest: route(streamedMessage),
      renderDocumentShell: ({ snapshot, snapshotId }) => ({
        beforeApplication: '<!doctype html><main data-custom-shell>',
        afterApplication: `</main><script id="${snapshotId}">${snapshot}</script>`,
      }),
    })(new Request('https://example.test/'))
    const streamingReader = streaming.body!.getReader()

    expect(new TextDecoder().decode((await streamingReader.read()).value)).toContain(
      'data-custom-shell',
    )
    streamedMessage.resolve('streamed')
    expect(await readReader(streamingReader)).toContain('streamed')

    let legacyResolved = false
    const legacyResponse = createStartHandler({
      manifest: route(bufferedMessage),
      renderDocument: ({ applicationHtml, snapshot }) =>
        `<main data-legacy>${applicationHtml}</main><script>${snapshot}</script>`,
    })(new Request('https://example.test/'))
    void legacyResponse.then(() => {
      legacyResolved = true
    })
    await Promise.resolve()
    expect(legacyResolved).toBe(false)
    bufferedMessage.resolve('buffered')
    expect(await (await legacyResponse).text()).toContain('data-legacy')
    expect(() =>
      createStartHandler({
        manifest: route(deferred()),
        renderDocument: () => '',
        renderDocumentShell: () => ({ afterApplication: '', beforeApplication: '' }),
      }),
    ).toThrow('renderDocument and renderDocumentShell cannot be used together')
  })

  it('propagates document stream errors and aborts while omitting HEAD render work', async () => {
    const pending = new Promise<never>(() => {})
    const component = vi.fn<() => ServerChild>(() =>
      Suspense({ children: () => use(pending), fallback: () => 'loading' }),
    )
    const manifest = createRouteManifest([
      entry('index', '/', null, defineFileRoute({ component })),
    ])
    const handler = createStartHandler({ manifest })
    const head = await handler(new Request('https://example.test/', { method: 'HEAD' }))
    expect(head.body).toBeNull()
    expect(component).not.toHaveBeenCalled()

    const abort = new AbortController()
    const response = await handler(new Request('https://example.test/', { signal: abort.signal }))
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('<!doctype html>')
    abort.abort(new Error('cancel Start document'))
    await expect(reader.read()).rejects.toThrow('cancel Start document')

    const failedManifest = createRouteManifest([
      entry(
        'index',
        '/',
        null,
        defineFileRoute({
          component: () => {
            throw new Error('Start document failed')
          },
        }),
      ),
    ])
    const failed = await createStartHandler({ manifest: failedManifest })(
      new Request('https://example.test/'),
    )
    const failedReader = failed.body!.getReader()
    expect(new TextDecoder().decode((await failedReader.read()).value)).toContain('<!doctype html>')
    await expect(failedReader.read()).rejects.toThrow('Start document failed')
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
    const handler = createStartHandler({ manifest })
    const url = 'https://example.test/products/bottle?currency=usd'
    const documentRequest = new Request(url)
    const navigationRequest = new Request(url, {
      headers: { [VIDACT_START_NAVIGATION_HEADER]: '1' },
    })
    const [documentResponse, response] = await Promise.all([
      handler(documentRequest),
      handler(navigationRequest),
    ])

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      `${VIDACT_START_SNAPSHOT_MEDIA_TYPE}; charset=utf-8`,
    )
    expect(response.headers.get('vary')).toBe(VIDACT_START_NAVIGATION_HEADER)
    expect(varyAwareCacheKey(documentRequest, documentResponse)).not.toBe(
      varyAwareCacheKey(navigationRequest, response),
    )
    expect(decodeStartSnapshot(await response.text())).toMatchObject({
      pathname: '/products/bottle?currency=usd',
      loaderData: { 'products/$productId': { productId: 'bottle' } },
    })
    expect(component).toHaveBeenCalledTimes(1)
  })

  it('declares response variation for document HEAD requests', async () => {
    const manifest = createRouteManifest([
      entry('index', '/', null, defineFileRoute({ component: () => 'ready' })),
    ])

    const response = await createStartHandler({ manifest })(
      new Request('https://example.test/', { method: 'HEAD' }),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('vary')).toBe(VIDACT_START_NAVIGATION_HEADER)
  })

  it('uses a cross-realm Response thrown by a loader as the route response', async () => {
    const component = vi.fn<() => string>(() => 'rendered')
    const manifest = createRouteManifest([
      entry(
        'docs/$',
        '/docs/*',
        null,
        defineFileRoute({
          loader: () => {
            throw createForeignRealmResponse('Unknown document', {
              status: 404,
              headers: { vary: 'accept-language', 'x-docs-miss': '1' },
            })
          },
          component,
        }),
      ),
    ])
    const handler = createStartHandler({ manifest })
    const foreignResponse = createForeignRealmResponse(null, { status: 404 })

    expect(foreignResponse).not.toBeInstanceOf(Response)
    expect(Object.prototype.toString.call(foreignResponse)).toBe('[object Response]')

    const documentResponse = await handler(new Request('https://example.test/docs/missing'))
    const navigationResponse = await handler(
      new Request('https://example.test/docs/missing', {
        headers: { [VIDACT_START_NAVIGATION_HEADER]: '1' },
      }),
    )
    const headResponse = await handler(
      new Request('https://example.test/docs/missing', { method: 'HEAD' }),
    )

    expect(documentResponse.status).toBe(404)
    expect(await documentResponse.text()).toBe('Unknown document')
    expect(documentResponse.headers.get('x-docs-miss')).toBe('1')
    expect(documentResponse.headers.get('vary')).toBe('accept-language')
    expect(navigationResponse.status).toBe(404)
    expect(headResponse.status).toBe(404)
    expect(headResponse.headers.get('x-docs-miss')).toBe('1')
    expect(await headResponse.text()).toBe('')
    expect(component).not.toHaveBeenCalled()
  })

  it('does not treat an arbitrary response-shaped loader error as a Response', async () => {
    const responseLikeError = { arrayBuffer() {}, headers: {}, status: 404 }
    const manifest = createRouteManifest([
      entry(
        'docs/$',
        '/docs/*',
        null,
        defineFileRoute({
          loader: () => {
            throw responseLikeError
          },
          component: () => 'unreachable',
        }),
      ),
    ])

    await expect(
      createStartHandler({ manifest })(new Request('https://example.test/docs/missing')),
    ).rejects.toBe(responseLikeError)
  })

  it('does not treat an own-tagged response lookalike as a Response', async () => {
    const taggedError = {
      [Symbol.toStringTag]: 'Response',
      arrayBuffer() {},
      clone() {
        return this
      },
      headers: new Headers(),
      status: 404,
    }
    const manifest = createRouteManifest([
      entry(
        'docs/$',
        '/docs/*',
        null,
        defineFileRoute({
          loader: () => {
            throw taggedError
          },
          component: () => 'unreachable',
        }),
      ),
    ])

    await expect(
      createStartHandler({ manifest })(new Request('https://example.test/docs/missing')),
    ).rejects.toBe(taggedError)
  })
})

function deferred<Value>(): {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value) => void
} {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function readReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- A stream reader is inherently sequential.
    const result = await reader.read()
    if (result.done) return text + decoder.decode()
    text += decoder.decode(result.value, { stream: true })
  }
}

function expectBalancedMarker(html: string, kind: 'b' | 'c' | 'r'): void {
  const opens = html.split(`<!--v2:${kind}-->`).length - 1
  const closes = html.split(`<!--/v2:${kind}-->`).length - 1
  expect(opens).toBeGreaterThan(0)
  expect(closes).toBe(opens)
}
