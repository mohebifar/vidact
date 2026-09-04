/** @jsxImportSource @vidact/runtime/framework/server */

import {
  createClientModuleManifest,
  createClientReference,
  createServerFunctionRegistry,
  createServerFunctionReference,
  decodeFrameworkValue,
  encodeFrameworkValue,
  invokeServerFunctionPayload,
  type FrameworkValue,
} from '@vidact/runtime/framework/protocol'
import {
  createClientBoundary,
  decodeServerComponentPayload,
  prerender,
  renderServerComponentPayload,
  renderToPipeableStream,
  renderToReadableStream,
  resume,
} from '@vidact/runtime/framework/server'
import {
  Suspense,
  cache,
  cacheSignal,
  preconnect,
  preload,
  use,
  type ServerChild,
} from '@vidact/runtime/server'
import { describe, expect, it } from 'vitest'

describe('framework server runtime', () => {
  it('waits for resources, preserves request cache identity, and emits a backpressured web stream', async () => {
    let resolve!: (value: string) => void
    let calls = 0
    const readMessage = cache((_key: string) => {
      calls += 1
      return new Promise<string>((resolvePromise) => {
        resolve = resolvePromise
      })
    })
    function Message(): ServerChild {
      expect(cacheSignal()).toBeInstanceOf(AbortSignal)
      return <strong>{use(readMessage('message'))}</strong>
    }
    const application = () =>
      Suspense({ children: () => <Message />, fallback: () => <p>loading</p> })

    const stream = await renderToReadableStream(application, { progressiveChunkSize: 7 })
    resolve('ready')
    const html = await readStream(stream)
    await stream.allReady
    expect(html).toContain('<strong>')
    expect(html).toContain('ready')
    expect(html).not.toContain('loading')
    expect(calls).toBe(1)
  })

  it('lets portable cached async work capture its request signal before suspension', async () => {
    let capturedBeforeAwait: AbortSignal | null = null
    let readAfterAwait: AbortSignal | null = null
    const read = cache(async () => {
      capturedBeforeAwait = cacheSignal()
      await Promise.resolve()
      readAfterAwait = cacheSignal()
      return 'ready'
    })

    const stream = await renderToReadableStream(() =>
      Suspense({
        children: () => <strong>{use(read())}</strong>,
        fallback: () => <span>pending</span>,
      }),
    )
    expect(await readStream(stream)).toContain('ready')
    expect(capturedBeforeAwait).toBeInstanceOf(AbortSignal)
    expect(readAfterAwait).toBeNull()
  })

  it('hoists and deduplicates metadata and resource hints into the document head', async () => {
    const stream = await renderToReadableStream(() => {
      preconnect('https://cdn.example.test', { crossOrigin: 'anonymous' })
      preconnect('https://cdn.example.test', { crossOrigin: 'anonymous' })
      preload('/app.css', { as: 'style', fetchPriority: 'high' })
      return (
        <html>
          <head>
            <meta name="description" content="first" />
          </head>
          <body>
            <title>Vidact framework</title>
            <meta name="description" content="second" />
            <meta itemProp="description" content="item metadata" />
            <link rel="stylesheet" href="/manual.css" />
            <style href="first-style" precedence="z-first">
              {'.first {}'}
            </style>
            <style href="second-style" precedence="a-second">
              {'.second {}'}
            </style>
            <main>content</main>
          </body>
        </html>
      )
    })
    const html = await readStream(stream)
    expect(html.indexOf('<title>Vidact framework</title>')).toBeLessThan(html.indexOf('<body>'))
    expect(html.match(/rel="preconnect"/g)).toHaveLength(1)
    expect(html).toContain('rel="preload" href="/app.css" as="style" fetchpriority="high"')
    expect(html.match(/name="description"/g)).toHaveLength(1)
    expect(html).toContain('content="second"')
    expect(html.indexOf('itemprop="description"')).toBeGreaterThan(html.indexOf('<body>'))
    expect(html.indexOf('href="/manual.css"')).toBeGreaterThan(html.indexOf('<body>'))
    expect(html.indexOf('.first {}')).toBeLessThan(html.indexOf('.second {}'))
  })

  it('produces integrity-checked prerender continuations and resumes final HTML', async () => {
    let resolve!: (value: string) => void
    const message = new Promise<string>((resolvePromise) => {
      resolve = resolvePromise
    })
    const application = () =>
      Suspense({
        children: () => <strong>{use(message)}</strong>,
        fallback: () => <p>loading</p>,
      })
    queueMicrotask(() => resolve('complete'))
    const result = await prerender(application)
    expect(await readStream(result.prelude)).toContain('loading')
    expect(result.postponed).not.toBeNull()
    expect(await readStream(await resume(result.postponed!))).toContain('complete')
    expect(() => decodeFrameworkValue(result.postponed!.replace('complete', 'tampered'))).toThrow(
      'integrity check failed',
    )
  })

  it('supports pipeable rendering with drain backpressure and lifecycle callbacks', async () => {
    const chunks: Uint8Array[] = []
    const callbacks: string[] = []
    let ended!: () => void
    const complete = new Promise<void>((resolve) => {
      ended = resolve
    })
    const stream = renderToPipeableStream(() => <p>pipeable</p>, {
      progressiveChunkSize: 3,
      onShellReady: () => callbacks.push('shell'),
      onAllReady: () => callbacks.push('all'),
    })
    stream.pipe({
      write(chunk) {
        chunks.push(chunk)
        return chunks.length % 2 === 0
      },
      once(event, listener) {
        expect(event).toBe('drain')
        queueMicrotask(listener)
      },
      end() {
        ended()
      },
    })
    await complete
    expect(new TextDecoder().decode(concatenate(chunks))).toContain('pipeable')
    expect(callbacks).toEqual(['shell', 'all'])
  })

  it('reports an unpiped pipeable render failure without leaving a rejected promise unobserved', async () => {
    let rejectShell!: (error: unknown) => void
    const shellError = new Promise<never>((_resolve, reject) => {
      rejectShell = reject
    })
    renderToPipeableStream(
      () => {
        throw new Error('pipeable render failed')
      },
      { onShellError: rejectShell },
    )

    await expect(shellError).rejects.toThrow('pipeable render failed')
  })

  it('serializes manifest-checked client references and allowlisted Server Functions', async () => {
    const manifest = createClientModuleManifest({ 'app/Counter': ['default'] })
    const reference = createClientReference('app/Counter')
    const payload = await renderServerComponentPayload(
      () => <main>server component</main>,
      { reference },
      { clientManifest: manifest },
    )
    const decoded = decodeServerComponentPayload(payload, manifest)
    expect(decoded.html).toContain('server component')
    expect(decoded.model).toEqual({ reference })

    const registry = createServerFunctionRegistry()
    registry.register('math/add', (left, right) => Number(left) + Number(right))
    const request = encodeFrameworkValue({ id: 'math/add', args: [2, 3] })
    expect(decodeFrameworkValue(await invokeServerFunctionPayload(registry, request))).toBe(5)
    await expect(
      invokeServerFunctionPayload(
        registry,
        encodeFrameworkValue({ id: 'math/delete-everything', args: [] }),
      ),
    ).rejects.toThrow('unknown server function')
    expect(
      decodeFrameworkValue(
        encodeFrameworkValue(createServerFunctionReference('math/add', [2] as FrameworkValue[])),
      ),
    ).toEqual(createServerFunctionReference('math/add', [2]))

    const tagShapedUserValue = {
      $vidact: 'undefined',
      nested: { $vidact: 'server-function', id: 'user-data', bound: [] },
    }
    expect(decodeFrameworkValue(encodeFrameworkValue(tagShapedUserValue))).toEqual(
      tagShapedUserValue,
    )

    registry.register('wait/forever', () => new Promise<never>(() => {}))
    const controller = new AbortController()
    const pendingInvocation = registry.invoke('wait/forever', [], controller.signal)
    controller.abort(new Error('cancel Server Function'))
    await expect(pendingInvocation).rejects.toThrow('cancel Server Function')
  })

  it('embeds a manifest-checked client boundary with an independently hydratable root', async () => {
    const manifest = createClientModuleManifest({ 'shop/Counter': ['counter'] })
    const reference = createClientReference('shop/Counter', 'counter')
    const stream = await renderToReadableStream(
      () =>
        createClientBoundary(reference, { initialCount: 2 }, <button>count 2</button>, {
          clientManifest: manifest,
          hostProps: { className: 'counter-boundary' },
        }),
      { identifierPrefix: 'rsc-' },
    )
    const html = await readStream(stream)

    expect(html).toContain('class="counter-boundary"')
    expect(html).toContain('data-vidact-client-boundary="true"')
    expect(html).toContain('data-vidact-client-payload=')
    expect(html).toContain('data-vidact-identifier-prefix="rsc-b0-"')
    expect(html).toContain('shop/Counter')
    expect(html.match(/v2:r/g)).toHaveLength(4)
  })

  it('bounds framework payload depth and node count for untrusted transport values', () => {
    let deeplyNested: FrameworkValue = null
    for (let depth = 0; depth < 101; depth += 1) deeplyNested = [deeplyNested]
    expect(() => encodeFrameworkValue(deeplyNested)).toThrow('cannot exceed depth 100')

    const tooManyNodes = Array.from({ length: 100_000 }, () => null)
    expect(() => encodeFrameworkValue(tooManyNodes)).toThrow('cannot exceed 100000 nodes')

    let encoded: unknown = null
    for (let depth = 0; depth < 101; depth += 1) encoded = [encoded]
    const body = JSON.stringify(encoded)
    const envelope = JSON.stringify({
      protocol: 'vidact-framework-v1',
      checksum: frameworkChecksum(body),
      body,
    })
    expect(() => decodeFrameworkValue(envelope)).toThrow('cannot exceed depth 100')
  })

  it('propagates abort signals through pending framework renders', async () => {
    const pending = new Promise<string>(() => {})
    const controller = new AbortController()
    const stream = await renderToReadableStream(
      () => Suspense({ children: () => use(pending), fallback: () => 'waiting' }),
      { signal: controller.signal },
    )
    controller.abort(new Error('cancel framework render'))
    await expect(stream.allReady).rejects.toThrow('cancel framework render')
  })
})

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- A stream reader is inherently sequential.
    const result = await reader.read()
    if (result.done) return new TextDecoder().decode(concatenate(chunks))
    chunks.push(result.value)
  }
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function frameworkChecksum(value: string): string {
  let hash = 0x81_1c_9d_c5
  for (const byte of new TextEncoder().encode(value)) {
    hash = Math.imul(hash ^ byte, 0x01_00_01_93)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
