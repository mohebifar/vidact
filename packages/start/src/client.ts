import {
  binding,
  cloneRenderable,
  compiledRoot,
  createComponentRenderable,
  createCompiledScope,
  createCompiledState,
  source,
  type CompiledComponentResult,
  type CompiledRenderValue,
  type CompiledRoot,
} from '@vidact/runtime'
import { hydrateRoot } from '@vidact/runtime/hydrate'

import {
  loadRouteMatches,
  matchRoutes,
  resolveRouteMatches,
  type LoadedRouteMatch,
  type RouteComponentProps,
  type RouteManifest,
  type RouteManifestEntry,
  type StartComponent,
} from './router.ts'
import {
  decodeStartSnapshot,
  VIDACT_START_NAVIGATION_HEADER,
  VIDACT_START_SNAPSHOT_MEDIA_TYPE,
} from './snapshot.ts'

const DEFAULT_ROOT_ID = 'vidact-start-root'
const DEFAULT_SNAPSHOT_ID = 'vidact-start-snapshot'
/** How long a prefetched snapshot may stand in for a fresh navigation request. */
const PREFETCH_STALE_TIME = 30_000
/** Hover must rest on a link this long before it counts as intent to navigate. */
const PREFETCH_HOVER_DELAY = 50

export interface HydrateStartOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly manifest: RouteManifest
  /**
   * Called when hydration could not attach to the server DOM and the root was rendered
   * client-side instead. Defaults to a console warning: a silent recovery looks like a
   * working page that merely flashes, and is far harder to notice than a warning.
   */
  readonly onRecoverableError?: (error: unknown) => void
  readonly root?: ParentNode
  readonly rootId?: string
  readonly snapshot?: string
  readonly snapshotId?: string
}

export interface StartNavigateOptions {
  readonly replace?: boolean
  readonly scroll?: boolean
}

export interface StartClient extends CompiledRoot {
  readonly navigate: (to: string | URL, options?: StartNavigateOptions) => Promise<boolean>
  /**
   * Fetches the route's snapshot and code ahead of a navigation. A navigation to the same
   * path and search within 30 seconds uses the prefetched snapshot instead of a new request.
   */
  readonly prefetch: (to: string | URL) => Promise<void>
}

type HistoryMode = 'none' | 'push' | 'replace'

type NavigationPayload =
  | { readonly kind: 'document' }
  | { readonly kind: 'snapshot'; readonly text: string }

interface PrefetchEntry {
  readonly expires: number
  readonly payload: Promise<NavigationPayload>
}

interface ClientRouteState {
  readonly components: readonly ClientRouteComponent[]
  readonly requestUrl: string
}

interface ClientRouteComponent {
  readonly component: StartComponent
  readonly entry: RouteManifestEntry
  readonly loaderData: LoadedRouteMatch['loaderData']
  readonly params: LoadedRouteMatch['params']
}

interface RetainedClientApplication {
  readonly application: () => CompiledComponentResult
  readonly state: ClientRouteState
  readonly update: (state: ClientRouteState) => void
}

const routeComponentIdentities = new WeakMap<RouteManifestEntry, WeakMap<StartComponent, object>>()

export async function hydrateStart(options: HydrateStartOptions): Promise<StartClient> {
  const snapshot = decodeStartSnapshot(
    options.snapshot ?? readSnapshot(options.snapshotId ?? DEFAULT_SNAPSHOT_ID),
  )
  const initialUrl = new URL(snapshot.pathname, window.location.href)
  const matches = matchRoutes(options.manifest, initialUrl.pathname)
  if (matches.length === 0) throw new Error(`cannot hydrate unmatched route ${snapshot.pathname}`)
  const request = new Request(initialUrl)
  const loaded = await loadRouteMatches(matches, request, snapshot.loaderData)
  const host =
    options.root ?? document.querySelector(`#${CSS.escape(options.rootId ?? DEFAULT_ROOT_ID)}`)
  if (host === null) throw new Error('Vidact Start hydration root is missing')

  let application = createClientApplication(loaded, request.url)
  const root = hydrateRoot(host, application.application, {
    onRecoverableError:
      options.onRecoverableError ??
      ((error) => console.warn('[vidact/start] hydration recovered by re-rendering:', error)),
  })
  const fetchNavigation = options.fetch ?? window.fetch.bind(window)
  let navigation = 0
  let navigationController: AbortController | undefined
  let disposed = false
  const prefetchController = new AbortController()
  const prefetches = new Map<string, PrefetchEntry>()
  let hoverAnchor: HTMLAnchorElement | undefined
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  /** The snapshot key of the navigation in flight, which prefetching must not duplicate. */
  let navigatingKey: string | undefined

  async function requestNavigationPayload(
    target: URL,
    signal: AbortSignal,
  ): Promise<NavigationPayload> {
    const response = await fetchNavigation(target, {
      credentials: 'same-origin',
      headers: { [VIDACT_START_NAVIGATION_HEADER]: '1' },
      signal,
    })
    if (
      !response.ok ||
      response.headers.get('content-type')?.split(';', 1)[0] !== VIDACT_START_SNAPSHOT_MEDIA_TYPE
    ) {
      return { kind: 'document' }
    }
    return { kind: 'snapshot', text: await response.text() }
  }

  async function prefetch(to: string | URL): Promise<void> {
    if (disposed) return
    const target = new URL(to, window.location.href)
    if (!isClientNavigationUrl(target) || isCurrentDocument(target)) return
    const targetMatches = matchRoutes(options.manifest, target.pathname)
    if (targetMatches.length === 0) return
    void resolveRouteMatches(targetMatches).catch(() => undefined)

    const key = prefetchKey(target)
    if (key === navigatingKey) return
    const now = Date.now()
    let entry = prefetches.get(key)
    if (entry === undefined || entry.expires <= now) {
      for (const [cachedKey, cached] of prefetches) {
        if (cached.expires <= now) prefetches.delete(cachedKey)
      }
      const created: PrefetchEntry = {
        expires: now + PREFETCH_STALE_TIME,
        payload: requestNavigationPayload(target, prefetchController.signal),
      }
      created.payload.catch(() => {
        if (prefetches.get(key) === created) prefetches.delete(key)
      })
      prefetches.set(key, created)
      entry = created
    }
    await entry.payload.then(
      () => undefined,
      () => undefined,
    )
  }

  /** Removes and returns a fresh prefetch so each snapshot backs at most one navigation. */
  function takePrefetch(target: URL): Promise<NavigationPayload> | undefined {
    const key = prefetchKey(target)
    const entry = prefetches.get(key)
    if (entry === undefined) return undefined
    prefetches.delete(key)
    return entry.expires > Date.now() ? entry.payload : undefined
  }

  async function navigate(
    to: string | URL,
    navigationOptions: StartNavigateOptions = {},
  ): Promise<boolean> {
    return performNavigation(
      new URL(to, window.location.href),
      navigationOptions.replace === true ? 'replace' : 'push',
      navigationOptions.scroll !== false,
    )
  }

  async function performNavigation(
    target: URL,
    historyMode: HistoryMode,
    scroll: boolean,
  ): Promise<boolean> {
    if (disposed) throw new Error('cannot navigate an unmounted Vidact Start client')
    if (!isClientNavigationUrl(target)) {
      navigateDocument(target, historyMode === 'replace')
      return false
    }
    const nextMatches = matchRoutes(options.manifest, target.pathname)
    if (nextMatches.length === 0) {
      navigateDocument(target, historyMode === 'replace')
      return false
    }

    navigation += 1
    const attempt = navigation
    navigationController?.abort()
    const controller = new AbortController()
    navigationController = controller
    navigatingKey = prefetchKey(target)
    cancelHover()

    // Route code downloads while the snapshot request is in flight instead of after it.
    void resolveRouteMatches(nextMatches).catch(() => undefined)

    try {
      const prefetched = await takePrefetch(target)?.catch(() => undefined)
      if (attempt !== navigation) return false
      const payload = prefetched ?? (await requestNavigationPayload(target, controller.signal))
      if (attempt !== navigation) return false
      if (payload.kind === 'document') {
        navigateDocument(target, historyMode === 'replace')
        return false
      }

      const nextSnapshot = decodeStartSnapshot(payload.text)
      const nextUrl = new URL(nextSnapshot.pathname, target.origin)
      // Fragments never reach the server request. Preserve the caller's fragment unless
      // the snapshot explicitly supplies one, including when the server redirects the path.
      if (nextUrl.hash === '') nextUrl.hash = target.hash
      const snapshotMatches = matchRoutes(options.manifest, nextUrl.pathname)
      if (snapshotMatches.length === 0) {
        navigateDocument(target, historyMode === 'replace')
        return false
      }
      const nextRequest = new Request(nextUrl)
      const nextLoaded = await loadRouteMatches(
        snapshotMatches,
        nextRequest,
        nextSnapshot.loaderData,
      )
      if (attempt !== navigation) return false

      const nextState = createClientRouteState(nextLoaded, nextRequest.url)
      if (sharedRouteComponentCount(application.state, nextState) === 0) {
        const replacement = createClientApplication(nextLoaded, nextRequest.url)
        root.replace(replacement.application)
        application = replacement
      } else {
        application.update(nextState)
      }
      updateHistory(nextUrl, historyMode)
      if (scroll) scrollToLocation(nextUrl)
      return true
    } catch {
      if (controller.signal.aborted || attempt !== navigation) return false
      navigateDocument(target, historyMode === 'replace')
      return false
    } finally {
      if (attempt === navigation) navigatingKey = undefined
    }
  }

  function handleClick(event: MouseEvent): void {
    const anchor = linkForEvent(event)
    if (anchor === undefined) return
    const target = new URL(anchor.href, window.location.href)
    if (
      target.pathname === window.location.pathname &&
      target.search === window.location.search &&
      target.hash !== window.location.hash
    ) {
      return
    }
    event.preventDefault()
    void performNavigation(
      target,
      anchor.hasAttribute('data-vidact-start-replace') ? 'replace' : 'push',
      true,
    )
  }

  function handlePopState(): void {
    void performNavigation(new URL(window.location.href), 'none', false)
  }

  function prefetchAnchor(anchor: HTMLAnchorElement): void {
    void prefetch(anchor.href)
  }

  function cancelHover(): void {
    if (hoverTimer !== undefined) clearTimeout(hoverTimer)
    hoverTimer = undefined
    hoverAnchor = undefined
  }

  function handlePointerOver(event: PointerEvent): void {
    const anchor = prefetchLinkForTarget(event.target)
    if (anchor === undefined || anchor === hoverAnchor || prefersReducedData()) return
    cancelHover()
    hoverAnchor = anchor
    hoverTimer = setTimeout(() => {
      hoverTimer = undefined
      prefetchAnchor(anchor)
    }, PREFETCH_HOVER_DELAY)
  }

  function handlePointerOut(event: PointerEvent): void {
    if (hoverAnchor === undefined) return
    const related = event.relatedTarget
    if (related instanceof Node && hoverAnchor.contains(related)) return
    cancelHover()
  }

  function handleFocusIn(event: FocusEvent): void {
    const anchor = prefetchLinkForTarget(event.target)
    if (anchor !== undefined && !prefersReducedData()) prefetchAnchor(anchor)
  }

  /** A press is a stronger signal than hover, so it prefetches even in data saver mode. */
  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    const anchor = prefetchLinkForTarget(event.target)
    if (anchor !== undefined) prefetchAnchor(anchor)
  }

  document.addEventListener('click', handleClick)
  document.addEventListener('pointerover', handlePointerOver)
  document.addEventListener('pointerout', handlePointerOut)
  document.addEventListener('focusin', handleFocusIn)
  document.addEventListener('pointerdown', handlePointerDown)
  window.addEventListener('popstate', handlePopState)

  return {
    mount: root.mount,
    replace: root.replace,
    navigate,
    prefetch,
    unmount() {
      if (disposed) return
      disposed = true
      navigation += 1
      navigationController?.abort()
      prefetchController.abort()
      prefetches.clear()
      cancelHover()
      document.removeEventListener('click', handleClick)
      document.removeEventListener('pointerover', handlePointerOver)
      document.removeEventListener('pointerout', handlePointerOut)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('popstate', handlePopState)
      root.unmount()
    },
  }
}

function createClientApplication(
  matches: readonly LoadedRouteMatch[],
  requestUrl: string,
): RetainedClientApplication {
  const initialState = createClientRouteState(matches, requestUrl)
  let currentState = initialState
  let updateState: ((state: ClientRouteState) => void) | undefined
  return {
    application: () => {
      const scope = createCompiledScope()
      const routeSource = source(0)
      const state = createCompiledState(scope, routeSource, currentState)
      updateState = (nextState) => {
        const previousState = currentState
        try {
          state.set(nextState)
          currentState = nextState
        } catch (error) {
          try {
            state.set(previousState)
          } catch {
            // Preserve the navigation failure that triggered the rollback.
          }
          currentState = previousState
          throw error
        }
      }
      const route = createRetainedRouteRenderable(scope, routeSource, state.get, 0)
      return compiledRoot(scope, () => cloneRenderable(route))
    },
    get state() {
      return currentState
    },
    update(nextState) {
      if (updateState === undefined) {
        throw new Error('cannot update a Vidact Start application before it mounts')
      }
      updateState(nextState)
    },
  }
}

function createClientRouteState(
  matches: readonly LoadedRouteMatch[],
  requestUrl: string,
): ClientRouteState {
  return {
    components: matches.flatMap((match) => {
      const component = match.definition.options.component
      return component === undefined
        ? []
        : [{ component, entry: match.entry, loaderData: match.loaderData, params: match.params }]
    }),
    requestUrl,
  }
}

function createRetainedRouteRenderable(
  scope: ReturnType<typeof createCompiledScope>,
  routeSource: ReturnType<typeof source>,
  readState: () => ClientRouteState,
  index: number,
): CompiledRenderValue {
  const initial = readState().components[index]
  if (initial === undefined) return undefined
  const identity = routeComponentIdentity(initial.entry, initial.component)
  let lastProps = routeComponentProps(scope, routeSource, readState, index)
  const input = binding(scope, routeSource, () => {
    const current = readState().components[index]
    if (
      current === undefined ||
      routeComponentIdentity(current.entry, current.component) !== identity
    ) {
      return lastProps
    }
    lastProps = routeComponentProps(scope, routeSource, readState, index)
    return lastProps
  })
  return createComponentRenderable(initial.component as never, input, identity)
}

function routeComponentProps(
  scope: ReturnType<typeof createCompiledScope>,
  routeSource: ReturnType<typeof source>,
  readState: () => ClientRouteState,
  index: number,
): RouteComponentProps {
  const state = readState()
  const match = state.components[index]!
  return {
    children: createRetainedRouteRenderable(scope, routeSource, readState, index + 1),
    loaderData: match.loaderData,
    params: match.params,
    requestUrl: state.requestUrl,
  }
}

function sharedRouteComponentCount(left: ClientRouteState, right: ClientRouteState): number {
  const length = Math.min(left.components.length, right.components.length)
  let index = 0
  while (index < length) {
    const previous = left.components[index]!
    const next = right.components[index]!
    if (previous.entry !== next.entry || previous.component !== next.component) break
    index += 1
  }
  return index
}

function routeComponentIdentity(entry: RouteManifestEntry, component: StartComponent): object {
  let componentIdentities = routeComponentIdentities.get(entry)
  if (componentIdentities === undefined) {
    componentIdentities = new WeakMap()
    routeComponentIdentities.set(entry, componentIdentities)
  }
  let identity = componentIdentities.get(component)
  if (identity === undefined) {
    identity = {}
    componentIdentities.set(component, identity)
  }
  return identity
}

function linkForEvent(event: MouseEvent): HTMLAnchorElement | undefined {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return undefined
  }
  return startLinkForTarget(event.target)
}

function prefetchLinkForTarget(target: EventTarget | null): HTMLAnchorElement | undefined {
  const anchor = startLinkForTarget(target)
  return anchor === undefined || anchor.dataset.vidactStartPrefetch === 'none' ? undefined : anchor
}

function startLinkForTarget(target: EventTarget | null): HTMLAnchorElement | undefined {
  if (!(target instanceof Element)) return undefined
  const anchor = target.closest<HTMLAnchorElement>('a[data-vidact-start-link]')
  if (
    anchor === null ||
    anchor.hasAttribute('download') ||
    (anchor.target !== '' && anchor.target !== '_self') ||
    anchor.rel.split(/\s+/u).includes('external')
  ) {
    return undefined
  }
  const url = new URL(anchor.href, window.location.href)
  return isClientNavigationUrl(url) ? anchor : undefined
}

function isClientNavigationUrl(url: URL): boolean {
  return (
    url.origin === window.location.origin && (url.protocol === 'http:' || url.protocol === 'https:')
  )
}

function isCurrentDocument(url: URL): boolean {
  return url.pathname === window.location.pathname && url.search === window.location.search
}

function prefetchKey(url: URL): string {
  return `${url.pathname}${url.search}`
}

function prefersReducedData(): boolean {
  const connection = (navigator as Navigator & { readonly connection?: { saveData?: boolean } })
    .connection
  return connection?.saveData === true
}

function updateHistory(url: URL, mode: HistoryMode): void {
  if (mode === 'push') window.history.pushState({}, '', url)
  else if (mode === 'replace') window.history.replaceState(window.history.state, '', url)
}

function scrollToLocation(url: URL): void {
  if (url.hash.length > 1) {
    let id: string
    try {
      id = decodeURIComponent(url.hash.slice(1))
    } catch {
      id = url.hash.slice(1)
    }
    const target = document.getElementById(id)
    if (target !== null) {
      target.scrollIntoView()
      return
    }
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
}

function navigateDocument(url: URL, replace: boolean): void {
  if (replace) window.location.replace(url)
  else window.location.assign(url)
}

function readSnapshot(id: string): string {
  const element = document.querySelector(`#${CSS.escape(id)}`)
  if (element === null) throw new Error(`Vidact Start snapshot ${id} is missing`)
  return element.textContent ?? ''
}

export type { StartComponent }
