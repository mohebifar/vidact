import type { CompiledComponentResult } from './compiled.ts'
import {
  decodeFrameworkValue,
  encodeFrameworkValue,
  type ClientModuleManifest,
  type ClientReference,
  type FrameworkValue,
} from './framework-protocol.ts'
import {
  createServerHydrationBoundary,
  createServerFrameworkRenderContext,
  renderToString,
  withServerFrameworkRenderContext,
  type ServerChild,
  type ServerFrameworkRenderContext,
  type ServerNode,
  type ServerRenderOptions,
} from './server.ts'

export * from './server.ts'
export * from './framework-protocol.ts'

export interface FrameworkRenderOptions extends ServerRenderOptions {
  readonly signal?: AbortSignal
  readonly progressiveChunkSize?: number
  readonly onError?: (error: unknown) => void
}

export interface PipeableRenderOptions extends FrameworkRenderOptions {
  readonly onAllReady?: () => void
  readonly onShellError?: (error: unknown) => void
  readonly onShellReady?: () => void
}

export interface PipeDestination {
  readonly write: (chunk: Uint8Array) => boolean
  readonly end: () => void
  readonly destroy?: (error: unknown) => void
  readonly once?: (event: 'drain', listener: () => void) => void
  readonly off?: (event: 'drain', listener: () => void) => void
}

export interface PipeableStream {
  readonly abort: (reason?: unknown) => void
  readonly pipe: (destination: PipeDestination) => void
}

export type VidactReadableStream = ReadableStream<Uint8Array> & {
  readonly allReady: Promise<void>
}

export interface PrerenderResult<Prelude> {
  readonly prelude: Prelude
  readonly postponed: string | null
}

export interface ServerComponentPayload {
  readonly kind: 'server-component'
  readonly html: string
  readonly model: FrameworkValue
}

export interface ClientBoundaryOptions {
  readonly clientManifest: ClientModuleManifest
  readonly hostProps?: Readonly<Record<string, unknown>>
}

export function createClientBoundary(
  reference: ClientReference,
  props: FrameworkValue,
  serverContent: ServerChild | CompiledComponentResult,
  options: ClientBoundaryOptions,
): ServerNode & CompiledComponentResult {
  const payload = encodeFrameworkValue({ reference, props }, options.clientManifest)
  return createServerHydrationBoundary(serverContent as ServerChild, {
    ...options.hostProps,
    'data-vidact-client-boundary': true,
    'data-vidact-client-payload': payload,
  }) as ServerNode & CompiledComponentResult
}

export function renderToReadableStream(
  value: ServerChild | (() => ServerChild),
  options: FrameworkRenderOptions = {},
): Promise<VidactReadableStream> {
  const controller = linkedAbortController(options.signal)
  const html = renderFrameworkHtml(value, options, controller.signal)
  return Promise.resolve(readableFromText(html, options.progressiveChunkSize, controller))
}

export function renderToPipeableStream(
  value: ServerChild | (() => ServerChild),
  options: PipeableRenderOptions = {},
): PipeableStream {
  const controller = linkedAbortController(options.signal)
  const html = renderFrameworkHtml(value, options, controller.signal, options)
  // A caller may create a stream for lifecycle callbacks and never pipe it. Mark the
  // render rejection as observed while retaining the original promise for pipe().
  void html.catch(() => undefined)
  let piped = false
  return {
    abort(reason) {
      controller.abort(reason)
    },
    pipe(destination) {
      if (piped) throw new Error('a Vidact pipeable stream can only be piped once')
      piped = true
      void pipeText(html, destination, options.progressiveChunkSize, controller.signal).catch(
        (error: unknown) => destination.destroy?.(error),
      )
    },
  }
}

export async function prerender(
  value: ServerChild | (() => ServerChild),
  options: FrameworkRenderOptions = {},
): Promise<PrerenderResult<ReadableStream<Uint8Array>>> {
  const controller = linkedAbortController(options.signal)
  const result = await prerenderText(value, options, controller.signal)
  return {
    prelude: readableFromText(
      Promise.resolve(result.prelude),
      options.progressiveChunkSize,
      controller,
    ),
    postponed: result.postponed,
  }
}

export async function prerenderToNodeStream(
  value: ServerChild | (() => ServerChild),
  options: FrameworkRenderOptions = {},
): Promise<PrerenderResult<AsyncIterable<Uint8Array>>> {
  const controller = linkedAbortController(options.signal)
  const result = await prerenderText(value, options, controller.signal)
  return {
    prelude: textIterable(result.prelude, options.progressiveChunkSize, controller.signal),
    postponed: result.postponed,
  }
}

export function resume(
  postponed: string,
  options: FrameworkRenderOptions = {},
): Promise<VidactReadableStream> {
  const controller = linkedAbortController(options.signal)
  const html = Promise.resolve(readContinuation(postponed))
  return Promise.resolve(readableFromText(html, options.progressiveChunkSize, controller))
}

export function resumeToPipeableStream(
  postponed: string,
  options: PipeableRenderOptions = {},
): PipeableStream {
  const controller = linkedAbortController(options.signal)
  const html = Promise.resolve(readContinuation(postponed))
  let piped = false
  queueMicrotask(() => options.onShellReady?.())
  void html.then(
    () => options.onAllReady?.(),
    (error: unknown) => options.onShellError?.(error),
  )
  return {
    abort(reason) {
      controller.abort(reason)
    },
    pipe(destination) {
      if (piped) throw new Error('a Vidact pipeable stream can only be piped once')
      piped = true
      void pipeText(html, destination, options.progressiveChunkSize, controller.signal).catch(
        (error: unknown) => destination.destroy?.(error),
      )
    },
  }
}

export async function renderServerComponentPayload(
  value: ServerChild | (() => ServerChild),
  model: FrameworkValue,
  options: FrameworkRenderOptions & { readonly clientManifest?: ClientModuleManifest } = {},
): Promise<string> {
  const controller = linkedAbortController(options.signal)
  const html = await renderFrameworkHtml(value, options, controller.signal)
  return encodeFrameworkValue({ kind: 'server-component', html, model }, options.clientManifest)
}

export function decodeServerComponentPayload(
  payload: string,
  clientManifest?: ClientModuleManifest,
): ServerComponentPayload {
  const value = decodeFrameworkValue(payload, clientManifest)
  if (
    !isRecord(value) ||
    value.kind !== 'server-component' ||
    typeof value.html !== 'string' ||
    !Object.hasOwn(value, 'model')
  ) {
    throw new TypeError('invalid Vidact Server Component payload')
  }
  return { kind: 'server-component', html: value.html, model: value.model as FrameworkValue }
}

async function renderFrameworkHtml(
  value: ServerChild | (() => ServerChild),
  options: FrameworkRenderOptions,
  signal: AbortSignal,
  callbacks: PipeableRenderOptions = {},
): Promise<string> {
  const context = createServerFrameworkRenderContext(signal)
  let shellReported = false
  for (let pass = 0; pass < 100; pass += 1) {
    throwIfAborted(signal)
    let html: string
    try {
      html = renderFrameworkPass(value, options, context)
    } catch (error) {
      options.onError?.(error)
      if (!shellReported) callbacks.onShellError?.(error)
      throw error
    }
    if (!shellReported) {
      shellReported = true
      callbacks.onShellReady?.()
    }
    if (context.pending.size === 0) {
      callbacks.onAllReady?.()
      return html
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each pass discovers the next resource frontier.
    await waitForResources(context.pending, signal)
  }
  throw new Error('Vidact framework render did not stabilize after 100 resource passes')
}

async function prerenderText(
  value: ServerChild | (() => ServerChild),
  options: FrameworkRenderOptions,
  signal: AbortSignal,
): Promise<{ readonly prelude: string; readonly postponed: string | null }> {
  const context = createServerFrameworkRenderContext(signal)
  const shell = renderFrameworkPass(value, options, context)
  if (context.pending.size === 0) return { prelude: shell, postponed: null }
  await waitForResources(context.pending, signal)
  const final = await settleFrameworkContext(value, options, context)
  return {
    prelude: shell,
    postponed: encodeFrameworkValue({ kind: 'continuation', html: final }),
  }
}

async function settleFrameworkContext(
  value: ServerChild | (() => ServerChild),
  options: FrameworkRenderOptions,
  context: ServerFrameworkRenderContext,
): Promise<string> {
  for (let pass = 0; pass < 100; pass += 1) {
    throwIfAborted(context.signal)
    const html = renderFrameworkPass(value, options, context)
    if (context.pending.size === 0) return html
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each pass discovers the next resource frontier.
    await waitForResources(context.pending, context.signal)
  }
  throw new Error('Vidact prerender did not stabilize after 100 resource passes')
}

function renderFrameworkPass(
  value: ServerChild | (() => ServerChild),
  options: ServerRenderOptions,
  context: ServerFrameworkRenderContext,
): string {
  return withServerFrameworkRenderContext(context, () => renderToString(value, options))
}

function readContinuation(postponed: string): string {
  const value = decodeFrameworkValue(postponed)
  if (!isRecord(value) || value.kind !== 'continuation' || typeof value.html !== 'string') {
    throw new TypeError('invalid Vidact continuation payload')
  }
  return value.html
}

function readableFromText(
  text: Promise<string>,
  requestedChunkSize: number | undefined,
  abortController: AbortController,
): VidactReadableStream {
  const chunkSize = normalizeChunkSize(requestedChunkSize)
  const encoder = new TextEncoder()
  let content: Uint8Array | undefined
  let offset = 0
  const allReady = text.then(() => undefined)
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        throwIfAborted(abortController.signal)
        content ??= encoder.encode(await text)
        if (offset >= content.length) {
          controller.close()
          return
        }
        const next = content.slice(offset, offset + chunkSize)
        offset += next.length
        controller.enqueue(next)
      } catch (error) {
        controller.error(error)
      }
    },
    cancel(reason) {
      abortController.abort(reason)
    },
  }) as VidactReadableStream
  Object.defineProperty(stream, 'allReady', { value: allReady })
  return stream
}

async function pipeText(
  text: Promise<string>,
  destination: PipeDestination,
  requestedChunkSize: number | undefined,
  signal: AbortSignal,
): Promise<void> {
  const content = new TextEncoder().encode(await text)
  const chunkSize = normalizeChunkSize(requestedChunkSize)
  for (let offset = 0; offset < content.length; offset += chunkSize) {
    throwIfAborted(signal)
    if (!destination.write(content.slice(offset, offset + chunkSize))) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Stream chunks must honor destination backpressure in order.
      await waitForDrain(destination, signal)
    }
  }
  destination.end()
}

async function* textIterable(
  text: string,
  requestedChunkSize: number | undefined,
  signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  const content = new TextEncoder().encode(text)
  const chunkSize = normalizeChunkSize(requestedChunkSize)
  for (let offset = 0; offset < content.length; offset += chunkSize) {
    throwIfAborted(signal)
    yield content.slice(offset, offset + chunkSize)
  }
}

function waitForResources(
  resources: Set<PromiseLike<unknown>>,
  signal: AbortSignal,
): Promise<void> {
  return withAbort(
    Promise.allSettled(resources).then(() => undefined),
    signal,
  )
}

function waitForDrain(destination: PipeDestination, signal: AbortSignal): Promise<void> {
  if (destination.once === undefined) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal))
      return
    }
    const onDrain = (): void => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const onAbort = (): void => {
      destination.off?.('drain', onDrain)
      reject(abortReason(signal))
    }
    destination.once?.('drain', onDrain)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function withAbort<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function linkedAbortController(signal?: AbortSignal): AbortController {
  const controller = new AbortController()
  if (signal?.aborted) controller.abort(signal.reason)
  else signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  return controller
}

function normalizeChunkSize(value: number | undefined): number {
  if (value === undefined) return 16_384
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('progressiveChunkSize must be a positive safe integer')
  }
  return value
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal)
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function isRecord(value: unknown): value is Record<string, FrameworkValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
