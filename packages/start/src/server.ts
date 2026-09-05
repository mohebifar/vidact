import { renderToReadableStream } from '@vidact/runtime/framework/server'
import { createElement, type ServerChild, type ServerComponent } from '@vidact/runtime/server'

import {
  composeRouteMatches,
  matchRoutes,
  resolveRouteMatches,
  routeLoaderData,
  runRouteLoaders,
  type ResolvedRouteMatch,
  type RouteManifest,
  type RouteServerHandler,
  type StartComponent,
} from './router.ts'
import {
  encodeStartSnapshot,
  VIDACT_START_NAVIGATION_HEADER,
  VIDACT_START_PROTOCOL,
  VIDACT_START_SNAPSHOT_MEDIA_TYPE,
} from './snapshot.ts'

/**
 * The client mounts the route tree under a compiled root of its own, and every compiled
 * root claims a component marker range while hydrating. Rendering the tree inside a
 * matching root component on the server keeps the two sides' component ranges aligned;
 * without it each client component would claim the range of the *next* server one.
 */
function StartApplication({ children }: { readonly children?: ServerChild }): ServerChild {
  return children
}

const DEFAULT_ROOT_ID = 'vidact-start-root'
const DEFAULT_SNAPSHOT_ID = 'vidact-start-snapshot'

export interface StartDocumentContext {
  readonly applicationHtml: string
  readonly clientEntry: string | undefined
  readonly rootId: string
  readonly snapshot: string
  readonly snapshotId: string
}

export interface StartDocumentShellContext {
  readonly clientEntry: string | undefined
  readonly rootId: string
  readonly snapshot: string
  readonly snapshotId: string
}

export interface StartDocumentShell {
  readonly afterApplication: string
  readonly beforeApplication: string
}

export interface StartHandlerOptions {
  readonly clientEntry?: string
  readonly manifest: RouteManifest
  readonly notFound?: (request: Request) => Response | Promise<Response>
  readonly renderDocument?: (context: StartDocumentContext) => string | Promise<string>
  readonly renderDocumentShell?: (
    context: StartDocumentShellContext,
  ) => StartDocumentShell | Promise<StartDocumentShell>
  readonly rootId?: string
  readonly snapshotId?: string
}

export function createStartHandler(
  options: StartHandlerOptions,
): (request: Request) => Promise<Response> {
  if (options.renderDocument !== undefined && options.renderDocumentShell !== undefined) {
    throw new TypeError('renderDocument and renderDocumentShell cannot be used together')
  }
  const rootId = options.rootId ?? DEFAULT_ROOT_ID
  const snapshotId = options.snapshotId ?? DEFAULT_SNAPSHOT_ID
  return async (request) => {
    const url = new URL(request.url)
    const matches = matchRoutes(options.manifest, url.pathname)
    if (matches.length === 0) {
      return options.notFound === undefined
        ? new Response('Not found', { status: 404 })
        : await options.notFound(request)
    }
    const resolved = await resolveRouteMatches(matches)
    const endpoint = endpointHandler(resolved, request.method)
    if (endpoint !== undefined) {
      const response = await endpoint({
        params: resolved.at(-1)!.params,
        request,
      })
      return responseForRequest(request, response)
    }
    const canRender = resolved.some((match) => match.definition.options.component !== undefined)
    if ((request.method !== 'GET' && request.method !== 'HEAD') || !canRender) {
      const allow = allowedMethods(resolved, canRender)
      if (allow.length === 0) {
        return options.notFound === undefined
          ? new Response('Not found', { status: 404 })
          : await options.notFound(request)
      }
      return new Response('Method not allowed', {
        status: 405,
        headers: { allow: allow.join(', ') },
      })
    }
    let loaded
    try {
      loaded = await runRouteLoaders(resolved, request)
    } catch (error) {
      if (isResponse(error)) return responseForRequest(request, error)
      throw error
    }
    const snapshot = escapeScriptText(
      encodeStartSnapshot({
        protocol: VIDACT_START_PROTOCOL,
        pathname: `${url.pathname}${url.search}`,
        loaderData: routeLoaderData(loaded),
      }),
    )
    if (request.headers.get(VIDACT_START_NAVIGATION_HEADER) === '1') {
      return new Response(request.method === 'HEAD' ? null : snapshot, {
        headers: representationHeaders(`${VIDACT_START_SNAPSHOT_MEDIA_TYPE}; charset=utf-8`),
      })
    }
    const headers = representationHeaders('text/html; charset=utf-8')
    if (request.method === 'HEAD') return new Response(null, { headers })

    const application = composeRouteMatches(
      loaded,
      (component, props) =>
        createElement(component as unknown as ServerComponent, props) as ServerChild,
      request.url,
    ) as ServerChild
    const stream = await renderToReadableStream(
      () => createElement(StartApplication, { children: application }) as ServerChild,
      { identifierPrefix: 'start-', signal: request.signal },
    )
    void stream.allReady.catch(() => undefined)
    const shellContext = {
      clientEntry: options.clientEntry,
      rootId,
      snapshot,
      snapshotId,
    }
    if (options.renderDocument !== undefined) {
      const applicationHtml = await new Response(stream).text()
      const html = await options.renderDocument({ ...shellContext, applicationHtml })
      return new Response(html, { headers })
    }
    const shell =
      options.renderDocumentShell === undefined
        ? defaultDocumentShell(shellContext)
        : validateDocumentShell(await options.renderDocumentShell(shellContext))
    return new Response(streamDocument(shell, stream), { headers })
  }
}

function representationHeaders(contentType: string): Headers {
  const headers = new Headers({ 'content-type': contentType })
  headers.append('vary', VIDACT_START_NAVIGATION_HEADER)
  return headers
}

function responseForRequest(request: Request, response: Response): Response {
  return request.method === 'HEAD' ? new Response(null, response) : response
}

function isResponse(value: unknown): value is Response {
  if (value instanceof Response) return true
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.prototype.hasOwnProperty.call(value, Symbol.toStringTag) ||
    Object.prototype.toString.call(value) !== '[object Response]'
  ) {
    return false
  }
  try {
    const candidate = value as Response
    return (
      typeof candidate.arrayBuffer === 'function' &&
      typeof candidate.clone === 'function' &&
      typeof candidate.headers?.get === 'function' &&
      Number.isInteger(candidate.status)
    )
  } catch {
    return false
  }
}

function endpointHandler(
  matches: readonly ResolvedRouteMatch[],
  method: string,
): RouteServerHandler | undefined {
  const handlers = matches.at(-1)?.definition.options.server?.handlers
  return handlers?.[method.toUpperCase()] ?? (method === 'HEAD' ? handlers?.GET : undefined)
}

function allowedMethods(
  matches: readonly ResolvedRouteMatch[],
  canRender: boolean,
): readonly string[] {
  const methods = new Set<string>()
  if (canRender) {
    methods.add('GET')
    methods.add('HEAD')
  }
  const handlers = matches.at(-1)?.definition.options.server?.handlers
  for (const method of Object.keys(handlers ?? {})) methods.add(method.toUpperCase())
  if (methods.has('GET')) methods.add('HEAD')
  return [...methods].toSorted(
    (left, right) => methodRank(left) - methodRank(right) || left.localeCompare(right),
  )
}

function methodRank(method: string): number {
  return method === 'GET' ? 0 : method === 'HEAD' ? 1 : 2
}

function defaultDocumentShell(context: StartDocumentShellContext): StartDocumentShell {
  const clientScript =
    context.clientEntry === undefined
      ? ''
      : `<script type="module" src="${escapeAttribute(context.clientEntry)}"></script>`
  return {
    beforeApplication: `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="${escapeAttribute(context.rootId)}">`,
    afterApplication: `</div><script id="${escapeAttribute(context.snapshotId)}" type="application/json">${context.snapshot}</script>${clientScript}</body></html>`,
  }
}

function validateDocumentShell(value: StartDocumentShell): StartDocumentShell {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof value.beforeApplication !== 'string' ||
    typeof value.afterApplication !== 'string'
  ) {
    throw new TypeError('renderDocumentShell must return beforeApplication and afterApplication')
  }
  return value
}

function streamDocument(
  shell: StartDocumentShell,
  application: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const before = encoder.encode(shell.beforeApplication)
  const after = encoder.encode(shell.afterApplication)
  const reader = application.getReader()
  let phase: 'after' | 'application' | 'before' | 'done' = 'before'
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (phase === 'before') {
          phase = 'application'
          if (before.length > 0) controller.enqueue(before)
          return
        }
        if (phase === 'application') {
          const result = await reader.read()
          if (!result.done) {
            controller.enqueue(result.value)
            return
          }
          phase = 'after'
        }
        if (phase === 'after') {
          phase = 'done'
          if (after.length > 0) controller.enqueue(after)
          return
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeScriptText(value: string): string {
  return value.replaceAll('&', '\\u0026').replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
}

export type { StartComponent }
