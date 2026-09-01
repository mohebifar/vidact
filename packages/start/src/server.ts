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

const DEFAULT_ROOT_ID = 'vidact-start-root'
const DEFAULT_SNAPSHOT_ID = 'vidact-start-snapshot'

export interface StartDocumentContext {
  readonly applicationHtml: string
  readonly clientEntry: string | undefined
  readonly rootId: string
  readonly snapshot: string
  readonly snapshotId: string
}

export interface StartHandlerOptions {
  readonly clientEntry?: string
  readonly manifest: RouteManifest
  readonly notFound?: (request: Request) => Response | Promise<Response>
  readonly renderDocument?: (context: StartDocumentContext) => string | Promise<string>
  readonly rootId?: string
  readonly snapshotId?: string
}

export function createStartHandler(
  options: StartHandlerOptions,
): (request: Request) => Promise<Response> {
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
        headers: { 'content-type': `${VIDACT_START_SNAPSHOT_MEDIA_TYPE}; charset=utf-8` },
      })
    }

    const application = composeRouteMatches(
      loaded,
      (component, props) =>
        createElement(component as unknown as ServerComponent, props) as ServerChild,
      request.url,
    ) as ServerChild
    const stream = await renderToReadableStream(() => application, {
      identifierPrefix: 'start-',
    })
    const applicationHtml = await new Response(stream).text()
    const documentContext = {
      applicationHtml,
      clientEntry: options.clientEntry,
      rootId,
      snapshot,
      snapshotId,
    }
    const html =
      options.renderDocument === undefined
        ? defaultDocument(documentContext)
        : await options.renderDocument(documentContext)
    return new Response(request.method === 'HEAD' ? null : html, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
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

function defaultDocument(context: StartDocumentContext): string {
  const clientScript =
    context.clientEntry === undefined
      ? ''
      : `<script type="module" src="${escapeAttribute(context.clientEntry)}"></script>`
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="${escapeAttribute(context.rootId)}">${context.applicationHtml}</div><script id="${escapeAttribute(context.snapshotId)}" type="application/json">${context.snapshot}</script>${clientScript}</body></html>`
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
