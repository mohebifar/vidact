import type { CompiledRenderValue } from '@vidact/runtime'
import type { FrameworkValue } from '@vidact/runtime/framework/protocol'

const FILE_ROUTE = Symbol('Vidact.Start.FileRoute')

export type RouteParameters = Readonly<Record<string, string>>
export type StartComponent<LoaderData extends FrameworkValue = FrameworkValue> = {
  bivarianceHack(props: RouteComponentProps<LoaderData>): unknown
}['bivarianceHack']

export interface RouteComponentProps<
  LoaderData extends FrameworkValue = FrameworkValue,
> extends Readonly<Record<string, unknown>> {
  readonly children?: CompiledRenderValue
  readonly loaderData: LoaderData
  readonly params: RouteParameters
  readonly requestUrl: string
}

export interface RouteLoaderContext {
  readonly parentData: Readonly<Record<string, FrameworkValue>>
  readonly params: RouteParameters
  readonly request: Request
}

export interface RouteServerContext {
  readonly params: RouteParameters
  readonly request: Request
}

export type RouteServerHandler = (context: RouteServerContext) => Response | Promise<Response>

export interface FileRouteOptions<LoaderData extends FrameworkValue = FrameworkValue> {
  readonly component?: StartComponent<LoaderData>
  readonly loader?: (context: RouteLoaderContext) => LoaderData | Promise<LoaderData>
  readonly server?: {
    readonly handlers: Readonly<Partial<Record<string, RouteServerHandler>>>
  }
}

export interface FileRouteDefinition<LoaderData extends FrameworkValue = FrameworkValue> {
  readonly [FILE_ROUTE]: true
  readonly options: FileRouteOptions<LoaderData>
}

export interface RouteModule {
  readonly Route?: FileRouteDefinition
  readonly default?: FileRouteDefinition
}

export interface RouteManifestEntry {
  readonly id: string
  readonly parentId: string | null
  readonly path: string
  readonly load: () => PromiseLike<RouteModule>
}

export interface RouteManifest {
  readonly entries: readonly RouteManifestEntry[]
  readonly byId: ReadonlyMap<string, RouteManifestEntry>
}

export interface RouteMatch {
  readonly entry: RouteManifestEntry
  readonly params: RouteParameters
}

export interface ResolvedRouteMatch extends RouteMatch {
  readonly definition: FileRouteDefinition
}

export interface LoadedRouteMatch extends ResolvedRouteMatch {
  readonly loaderData: FrameworkValue
}

export function defineFileRoute<const LoaderData extends FrameworkValue = undefined>(
  options: FileRouteOptions<LoaderData>,
): FileRouteDefinition<LoaderData> {
  return Object.freeze({ [FILE_ROUTE]: true as const, options: Object.freeze({ ...options }) })
}

export function isFileRouteDefinition(value: unknown): value is FileRouteDefinition {
  return typeof value === 'object' && value !== null && FILE_ROUTE in value
}

export function createRouteManifest(entries: readonly RouteManifestEntry[]): RouteManifest {
  const byId = new Map<string, RouteManifestEntry>()
  for (const entry of entries) {
    if (entry.id.length === 0) throw new TypeError('route id must be non-empty')
    if (!entry.path.startsWith('/')) throw new TypeError(`route ${entry.id} path must start with /`)
    if (byId.has(entry.id)) throw new TypeError(`duplicate route id ${entry.id}`)
    byId.set(entry.id, Object.freeze({ ...entry }))
  }
  for (const entry of byId.values()) {
    if (entry.parentId !== null && !byId.has(entry.parentId)) {
      throw new TypeError(`route ${entry.id} has unknown parent ${entry.parentId}`)
    }
    assertAcyclicParentChain(entry, byId)
  }
  const frozenEntries = Object.freeze([...byId.values()])
  return Object.freeze({ entries: frozenEntries, byId })
}

export function matchRoutes(manifest: RouteManifest, pathname: string): readonly RouteMatch[] {
  const normalized = normalizePathname(pathname)
  let selected: { entry: RouteManifestEntry; params: RouteParameters; score: number } | undefined
  for (const entry of manifest.entries) {
    const match = matchPath(entry.path, normalized)
    if (match === undefined) continue
    const score = routeScore(entry, manifest)
    if (selected === undefined || score > selected.score) selected = { entry, params: match, score }
  }
  if (selected === undefined) return []
  const chain: RouteManifestEntry[] = []
  let entry: RouteManifestEntry | undefined = selected.entry
  while (entry !== undefined) {
    chain.push(entry)
    entry = entry.parentId === null ? undefined : manifest.byId.get(entry.parentId)
  }
  return Object.freeze(
    chain.toReversed().map((matchedEntry) =>
      Object.freeze({
        entry: matchedEntry,
        params: Object.freeze({ ...selected.params }),
      }),
    ),
  )
}

export async function loadRouteMatches(
  matches: readonly RouteMatch[],
  request: Request,
  suppliedData: Readonly<Record<string, FrameworkValue>> = {},
): Promise<readonly LoadedRouteMatch[]> {
  return runRouteLoaders(await resolveRouteMatches(matches), request, suppliedData)
}

export async function resolveRouteMatches(
  matches: readonly RouteMatch[],
): Promise<readonly ResolvedRouteMatch[]> {
  return Object.freeze(
    await Promise.all(
      matches.map(async (match) => {
        const module = await match.entry.load()
        return Object.freeze({
          ...match,
          definition: readRouteDefinition(match.entry.id, module),
        })
      }),
    ),
  )
}

export async function runRouteLoaders(
  matches: readonly ResolvedRouteMatch[],
  request: Request,
  suppliedData: Readonly<Record<string, FrameworkValue>> = {},
): Promise<readonly LoadedRouteMatch[]> {
  const loaded: LoadedRouteMatch[] = []
  const parentData: Record<string, FrameworkValue> = { ...suppliedData }
  for (const match of matches) {
    const loaderData = Object.hasOwn(suppliedData, match.entry.id)
      ? suppliedData[match.entry.id]
      : match.definition.options.loader === undefined
        ? undefined
        : // oxlint-disable-next-line no-await-in-loop -- Descendants receive settled parent data.
          await match.definition.options.loader({
            parentData: Object.freeze({ ...parentData }),
            params: match.params,
            request,
          })
    parentData[match.entry.id] = loaderData
    loaded.push(Object.freeze({ ...match, loaderData }))
  }
  return Object.freeze(loaded)
}

export function composeRouteMatches(
  matches: readonly LoadedRouteMatch[],
  createElement: (component: StartComponent, props: RouteComponentProps) => unknown,
  requestUrl: string,
): unknown {
  let children: CompiledRenderValue | undefined
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]!
    const component = match.definition.options.component
    if (component === undefined) continue
    children = createElement(component, {
      children,
      loaderData: match.loaderData,
      params: match.params,
      requestUrl,
    }) as CompiledRenderValue
  }
  return children
}

export function routeLoaderData(
  matches: readonly LoadedRouteMatch[],
): Readonly<Record<string, FrameworkValue>> {
  return Object.freeze(
    Object.fromEntries(matches.map((match) => [match.entry.id, match.loaderData])) as Record<
      string,
      FrameworkValue
    >,
  )
}

function readRouteDefinition(id: string, module: RouteModule): FileRouteDefinition {
  const definition = module.Route ?? module.default
  if (!isFileRouteDefinition(definition)) {
    throw new TypeError(`route module ${id} must export a Route created by defineFileRoute`)
  }
  return definition
}

function matchPath(pattern: string, pathname: string): RouteParameters | undefined {
  if (pattern === '/') return pathname === '/' ? Object.freeze({}) : undefined
  const patternSegments = segments(pattern)
  const pathSegments = segments(pathname)
  const parameters: Record<string, string> = {}
  let pathIndex = 0
  for (const segment of patternSegments) {
    if (segment === '*') {
      if (pathIndex >= pathSegments.length) return undefined
      parameters['*'] = decodeSegment(pathSegments.slice(pathIndex).join('/'))
      pathIndex = pathSegments.length
      break
    }
    const value = pathSegments[pathIndex]
    if (value === undefined) return undefined
    if (segment.startsWith(':')) parameters[segment.slice(1)] = decodeSegment(value)
    else if (segment !== value) return undefined
    pathIndex += 1
  }
  return pathIndex === pathSegments.length ? Object.freeze(parameters) : undefined
}

function normalizePathname(pathname: string): string {
  const path = pathname.split(/[?#]/u, 1)[0] ?? '/'
  if (!path.startsWith('/')) throw new TypeError('route pathname must start with /')
  return path.length > 1 ? path.replace(/\/+$/u, '') : '/'
}

function segments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean)
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new TypeError(`invalid encoded route segment ${value}`)
  }
}

function routeScore(entry: RouteManifestEntry, manifest: RouteManifest): number {
  const specificity = segments(entry.path).reduce(
    (score, segment) => score + (segment === '*' ? 1 : segment.startsWith(':') ? 10 : 100),
    0,
  )
  let depth = 0
  let current: RouteManifestEntry | undefined = entry
  while (current !== undefined) {
    depth += 1
    current = current.parentId === null ? undefined : manifest.byId.get(current.parentId)
  }
  return specificity * 1_000 + depth
}

function assertAcyclicParentChain(
  entry: RouteManifestEntry,
  byId: ReadonlyMap<string, RouteManifestEntry>,
): void {
  const visited = new Set<string>([entry.id])
  let parentId = entry.parentId
  while (parentId !== null) {
    if (visited.has(parentId)) throw new TypeError(`route ${entry.id} has a cyclic parent chain`)
    visited.add(parentId)
    parentId = byId.get(parentId)?.parentId ?? null
  }
}
