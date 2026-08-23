import type { CompiledComponentResult, MountCompiledOptions } from './compiled.ts'
import { installHydration } from './hydration.ts'
import { hydrateRoot, type CompiledRoot } from './root.ts'

installHydration()

export * from './framework.ts'

export interface EventReplayQueue {
  readonly dispose: () => void
  readonly replay: () => void
  readonly size: () => number
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
