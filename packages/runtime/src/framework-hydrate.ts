import type { CompiledComponentResult, MountCompiledOptions } from './compiled.ts'
import {
  decodeFrameworkValue,
  isClientBoundaryDefinition,
  isClientReference,
  type ClientReference,
  type FrameworkValue,
} from './framework.ts'
import { installHydration } from './hydration.ts'
import { hydrateRoot, type CompiledRoot } from './root.ts'

installHydration()

export * from './framework.ts'

export interface EventReplayQueue {
  readonly dispose: () => void
  readonly replay: () => void
  readonly size: () => number
}

export type ClientModuleLoader = (
  reference: ClientReference,
) => PromiseLike<Readonly<Record<string, unknown>>>

export interface HydratedClientBoundaries {
  readonly roots: readonly CompiledRoot[]
  readonly dispose: () => void
  readonly replace: (loadModule?: ClientModuleLoader) => Promise<void>
}

type ReplayRecord = {
  readonly type: string
  readonly path: readonly number[]
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly value?: string
  readonly checked?: boolean
}

const DEFAULT_REPLAY_EVENTS = ['click', 'input', 'change', 'submit'] as const

export function createEventReplayQueue(
  host: ParentNode,
  events: readonly string[] = DEFAULT_REPLAY_EVENTS,
): EventReplayQueue {
  const records: ReplayRecord[] = []
  let disposed = false
  const capture = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Node)) return
    const path = nodePath(host, target)
    if (path === undefined) return
    if (event.type === 'submit') event.preventDefault()
    records.push({
      type: event.type,
      path,
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      ...(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        ? { value: target.value }
        : {}),
      ...(target instanceof HTMLInputElement ? { checked: target.checked } : {}),
    })
  }
  for (const event of events) host.addEventListener(event, capture, true)
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const event of events) host.removeEventListener(event, capture, true)
  }
  return {
    dispose,
    replay() {
      dispose()
      for (const record of records.splice(0)) {
        const target = resolveNodePath(host, record.path)
        if (!(target instanceof Element)) continue
        if (
          record.value !== undefined &&
          (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
        ) {
          target.value = record.value
        }
        if (record.checked !== undefined && target instanceof HTMLInputElement) {
          target.checked = record.checked
        }
        target.dispatchEvent(
          new Event(record.type, { bubbles: record.bubbles, cancelable: record.cancelable }),
        )
      }
    },
    size: () => records.length,
  }
}

export function hydrateFrameworkBoundary(
  host: ParentNode,
  application: () => CompiledComponentResult,
  options?: MountCompiledOptions & { readonly replay?: EventReplayQueue },
): CompiledRoot {
  try {
    const root = hydrateRoot(host, application, options)
    options?.replay?.replay()
    return root
  } catch (error) {
    options?.replay?.dispose()
    throw error
  }
}

export async function hydrateClientBoundaries(
  root: ParentNode,
  loadModule: ClientModuleLoader,
  options?: MountCompiledOptions,
): Promise<HydratedClientBoundaries> {
  const hosts = clientBoundaryHosts(root)
  const payloads = hosts.map(readClientBoundaryPayload)
  const replays = hosts.map((host) => createEventReplayQueue(host))
  const roots: CompiledRoot[] = []
  try {
    const applications = await Promise.all(
      payloads.map((payload) => prepareClientBoundary(loadModule, payload)),
    )
    for (const [index, host] of hosts.entries()) {
      const identifierPrefix = host.getAttribute('data-vidact-identifier-prefix') ?? ''
      roots[index] = hydrateFrameworkBoundary(host, applications[index]!, {
        ...options,
        identifierPrefix,
        replay: replays[index]!,
      })
    }
  } catch (error) {
    for (const replay of replays) replay.dispose()
    for (const compiledRoot of roots) compiledRoot?.unmount()
    throw error
  }
  return {
    roots,
    dispose() {
      for (const compiledRoot of roots) compiledRoot.unmount()
    },
    async replace(nextLoader = loadModule) {
      const applications = await Promise.all(
        payloads.map((payload) => prepareClientBoundary(nextLoader, payload)),
      )
      for (const [index, compiledRoot] of roots.entries()) {
        compiledRoot.replace(applications[index]!)
      }
    },
  }
}

async function prepareClientBoundary(
  loadModule: ClientModuleLoader,
  { reference, props }: ClientBoundaryPayload,
): Promise<() => CompiledComponentResult> {
  const definition = await loadClientBoundary(loadModule, reference)
  const prepared = await definition.prepare?.(props)
  return () => definition.render(props, prepared)
}

async function loadClientBoundary(loadModule: ClientModuleLoader, reference: ClientReference) {
  const module = await loadModule(reference)
  const definition = module[reference.exportName]
  if (!isClientBoundaryDefinition(definition)) {
    throw new TypeError(
      `client module ${reference.id} does not export Vidact boundary ${reference.exportName}`,
    )
  }
  return definition
}

function clientBoundaryHosts(root: ParentNode): HTMLElement[] {
  const selector = '[data-vidact-client-boundary][data-vidact-client-payload]'
  const descendants = [...root.querySelectorAll<HTMLElement>(selector)]
  return root instanceof HTMLElement && root.matches(selector)
    ? [root, ...descendants]
    : descendants
}

interface ClientBoundaryPayload {
  readonly reference: ClientReference
  readonly props: FrameworkValue
}

function readClientBoundaryPayload(host: HTMLElement): ClientBoundaryPayload {
  const encoded = host.getAttribute('data-vidact-client-payload')
  if (encoded === null) throw new TypeError('client boundary payload is missing')
  const payload = decodeFrameworkValue(encoded)
  if (
    !isRecord(payload) ||
    !Object.hasOwn(payload, 'props') ||
    !isClientReference(payload.reference)
  ) {
    throw new TypeError('invalid Vidact client boundary payload')
  }
  return { reference: payload.reference, props: payload.props as FrameworkValue }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nodePath(root: ParentNode, node: Node): readonly number[] | undefined {
  const path: number[] = []
  let current: Node | null = node
  while (current !== null && current !== root) {
    const parentNode: ParentNode | null = current.parentNode
    if (parentNode === null) return undefined
    path.push(Array.prototype.indexOf.call(parentNode.childNodes, current) as number)
    current = parentNode
  }
  return current === root ? path.toReversed() : undefined
}

function resolveNodePath(root: ParentNode, path: readonly number[]): Node | undefined {
  let current: Node = root as Node
  for (const index of path) {
    const next = current.childNodes[index]
    if (next === undefined) return undefined
    current = next
  }
  return current
}
