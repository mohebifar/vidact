import { readdir } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

import { vidact, type VidactPluginOptions } from '@vidact/vite'
import {
  isRunnableDevEnvironment,
  normalizePath,
  type Plugin,
  type ResolvedConfig,
  type ViteDevServer,
} from 'vite'

const PUBLIC_ROUTES_ID = 'virtual:vidact-start/routes'
const INTERNAL_ROUTES_ID = `\0${PUBLIC_ROUTES_ID}`
const ROUTE_FILE = /\.(?:[cm]?[jt]sx?)$/u
const IGNORED_ROUTE_FILE = /(?:^|\.)\b(?:test|spec)\.[cm]?[jt]sx?$/u

export interface VidactStartOptions {
  readonly compiler?: Omit<VidactPluginOptions, 'target'>
  readonly routesDirectory?: string
  readonly serverEntry?: string | false
  readonly serverExport?: string
}

export interface GeneratedRouteRecord {
  readonly file: string
  readonly id: string
  readonly parentId: string | null
  readonly path: string
}

export function vidactStart(options: VidactStartOptions = {}): Plugin[] {
  const compiler = options.compiler ?? {}
  const features = [...new Set(['framework', ...(compiler.features ?? [])])] as NonNullable<
    VidactPluginOptions['features']
  >
  const plugins = [
    vidactForEnvironment('client', { ...compiler, target: 'hydrate', features }),
    vidactForEnvironment('ssr', { ...compiler, target: 'server', features }),
    routeManifestPlugin(options.routesDirectory),
  ]
  if (options.serverEntry !== false) {
    plugins.push(
      developmentServerPlugin(
        options.serverEntry ?? '/src/server.ts',
        options.serverExport ?? 'default',
      ),
    )
  }
  return plugins
}

function routeManifestPlugin(configuredRoutesDirectory: string | undefined): Plugin {
  let config: ResolvedConfig
  let routesDirectory: string
  let server: ViteDevServer | undefined
  return {
    name: 'vidact-start-routes',
    configResolved(resolved) {
      config = resolved
      routesDirectory = path.resolve(config.root, configuredRoutesDirectory ?? 'src/routes')
    },
    configureServer(viteServer) {
      server = viteServer
      viteServer.watcher.add(routesDirectory)
    },
    resolveId(source) {
      return source === PUBLIC_ROUTES_ID ? INTERNAL_ROUTES_ID : null
    },
    async load(id) {
      if (id !== INTERNAL_ROUTES_ID) return null
      return generateRouteModule(await discoverRouteRecords(routesDirectory))
    },
    handleHotUpdate(context) {
      if (!isRouteFile(routesDirectory, context.file)) return
      const module = server?.moduleGraph.getModuleById(INTERNAL_ROUTES_ID)
      if (module !== undefined) server?.moduleGraph.invalidateModule(module)
      server?.ws.send({ type: 'full-reload' })
      return []
    },
  }
}

function vidactForEnvironment(
  environmentName: 'client' | 'ssr',
  options: VidactPluginOptions,
): Plugin {
  const plugin = vidact(options)
  return {
    ...plugin,
    name: `${plugin.name}:start:${environmentName}`,
    applyToEnvironment: (environment) => environment.name === environmentName,
  }
}

function developmentServerPlugin(serverEntry: string, serverExport: string): Plugin {
  return {
    name: 'vidact-start-development-server',
    config: () => ({ appType: 'custom' }),
    configureServer(server) {
      return () => {
        server.middlewares.use((nodeRequest, nodeResponse, next) => {
          void serveDevelopmentRequest(
            server,
            serverEntry,
            serverExport,
            nodeRequest,
            nodeResponse,
          ).catch((error: unknown) => {
            if (error instanceof Error) server.ssrFixStacktrace(error)
            next(error)
          })
        })
      }
    },
  }
}

async function serveDevelopmentRequest(
  server: ViteDevServer,
  serverEntry: string,
  serverExport: string,
  nodeRequest: IncomingMessage,
  nodeResponse: ServerResponse,
): Promise<void> {
  const environment = server.environments.ssr
  if (!isRunnableDevEnvironment(environment)) {
    throw new Error("Vidact Start requires Vite's runnable SSR development environment")
  }
  const module = (await environment.runner.import(serverEntry)) as Record<string, unknown>
  const handler = module[serverExport]
  if (typeof handler !== 'function') {
    throw new TypeError(`${serverEntry} must export a ${serverExport} request handler`)
  }
  const request = await nodeRequestToRequest(nodeRequest)
  let response = await (handler as (request: Request) => Response | Promise<Response>)(request)
  if (!(response instanceof Response)) {
    throw new TypeError(`${serverEntry} ${serverExport} must return a Response`)
  }
  if (response.headers.get('content-type')?.startsWith('text/html') === true) {
    const html = await server.transformIndexHtml(nodeRequest.url ?? '/', await response.text())
    response = new Response(html, response)
  }
  await sendNodeResponse(nodeResponse, response)
}

async function nodeRequestToRequest(request: IncomingMessage): Promise<Request> {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }
  const forwardedProtocol = headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim()
  const protocol =
    forwardedProtocol ?? (Reflect.get(request.socket, 'encrypted') === true ? 'https' : 'http')
  const url = new URL(request.url ?? '/', `${protocol}://${headers.get('host') ?? 'localhost'}`)
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await readRequestBody(request)
  return new Request(url, {
    method: request.method ?? 'GET',
    headers,
    ...(body === undefined ? {} : { body }),
  })
}

async function readRequestBody(request: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Uint8Array.from(Buffer.concat(chunks)).buffer
}

async function sendNodeResponse(response: ServerResponse, webResponse: Response): Promise<void> {
  response.statusCode = webResponse.status
  response.statusMessage = webResponse.statusText
  for (const [name, value] of webResponse.headers) response.setHeader(name, value)
  const cookies = webResponse.headers.getSetCookie()
  if (cookies.length > 0) response.setHeader('set-cookie', cookies)
  response.end(Buffer.from(await webResponse.arrayBuffer()))
}

export async function discoverRouteRecords(
  routesDirectory: string,
): Promise<readonly GeneratedRouteRecord[]> {
  let filenames: string[]
  try {
    filenames = await readdir(routesDirectory, { recursive: true })
  } catch (error) {
    if (isMissingDirectory(error)) return []
    throw error
  }
  const records = filenames
    .filter((filename) => ROUTE_FILE.test(filename) && !IGNORED_ROUTE_FILE.test(filename))
    .map((filename) => routeFileToRecord(filename, routesDirectory))
  const ids = new Set(records.map((record) => record.id))
  return Object.freeze(
    records
      .map((record) => Object.freeze({ ...record, parentId: parentRouteId(record.id, ids) }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  )
}

export function routeFileToRecord(filename: string, routesDirectory: string): GeneratedRouteRecord {
  const normalizedFilename = normalizePath(filename)
  const id = normalizedFilename.replace(ROUTE_FILE, '')
  if (id.length === 0) throw new TypeError(`invalid route filename ${filename}`)
  const routeSegments = id
    .split('/')
    .filter((segment) => segment !== '__root' && segment !== 'index' && !segment.startsWith('_'))
    .map((segment) =>
      segment === '$' ? '*' : segment.startsWith('$') ? `:${segment.slice(1)}` : segment,
    )
  return {
    file: normalizePath(path.resolve(routesDirectory, normalizedFilename)),
    id,
    parentId: null,
    path: routeSegments.length === 0 ? '/' : `/${routeSegments.join('/')}`,
  }
}

function parentRouteId(id: string, ids: ReadonlySet<string>): string | null {
  if (id === '__root') return null
  const segments = id.split('/')
  if (segments.at(-1) === 'index') segments.pop()
  while (segments.length > 0) {
    const candidate = segments.join('/')
    if (candidate !== id && ids.has(candidate)) return candidate
    segments.pop()
  }
  return ids.has('__root') ? '__root' : null
}

function generateRouteModule(records: readonly GeneratedRouteRecord[]): string {
  const entries = records
    .map(
      (record) =>
        `{ id: ${JSON.stringify(record.id)}, parentId: ${JSON.stringify(record.parentId)}, path: ${JSON.stringify(record.path)}, load: () => import(${JSON.stringify(record.file)}) }`,
    )
    .join(',\n  ')
  return `import { createRouteManifest } from '@vidact/start'\n\nexport const routeManifest = createRouteManifest([\n  ${entries}\n])\n`
}

function isRouteFile(routesDirectory: string, filename: string): boolean {
  const relative = path.relative(routesDirectory, filename)
  return (
    !relative.startsWith('..') && ROUTE_FILE.test(relative) && !IGNORED_ROUTE_FILE.test(relative)
  )
}

function isMissingDirectory(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT'
}
