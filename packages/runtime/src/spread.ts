import {
  mountCompiledPropTransition,
  registerCompiledCleanup,
  type CompiledBinding,
} from './compiled.ts'
import { attachEventProp, isEventProp } from './dom/events.ts'
import { ensureControlledFormRestoration, isControlledFormProp } from './dom/forms.ts'
import { INTERNAL_NAMESPACE_PROP } from './dom/namespace.ts'
import { applyDomProp } from './dom/properties.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__
let spreadId = 0

export function compiledSpread(
  binding: CompiledBinding<unknown>,
  overriddenNames: readonly string[],
): Record<string, (element: Element) => boolean> {
  return {
    [`__vidactSpread${spreadId++}`]: (element) =>
      mountReactiveSpread(element, binding, overriddenNames),
  }
}

function mountReactiveSpread(
  element: Element,
  binding: CompiledBinding<unknown>,
  overriddenNames: readonly string[],
): boolean {
  const overrides = new Set(overriddenNames)
  const cleanups = new Map<string, () => void>()
  let controlledCleanup: (() => void) | undefined
  let restoreAfterChildren = false
  const apply = (name: string, value: unknown): (() => void) => {
    if (
      name === 'children' ||
      name === 'key' ||
      name === 'ref' ||
      name === 'dangerouslySetInnerHTML' ||
      name === INTERNAL_NAMESPACE_PROP
    ) {
      throw new TypeError(
        DEV
          ? `reactive JSX spread property ${name} requires dedicated ownership semantics`
          : 'V105',
      )
    }
    if (isControlledFormProp(element, name) && controlledCleanup === undefined) {
      controlledCleanup = ensureControlledFormRestoration(element)
    }
    if (name === 'value' && element instanceof HTMLSelectElement) restoreAfterChildren = true
    if (isEventProp(name)) return attachEventProp(element, name, value)
    applyDomProp(element, name, value)
    return () => {}
  }
  const active = (value: unknown): Record<string, unknown> => {
    if (value === null || value === undefined) return {}
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(DEV ? 'reactive JSX spread value must be an object or nullish' : 'V105')
    }
    return value as Record<string, unknown>
  }
  const visibleEntries = (value: Record<string, unknown>): Array<[string, unknown]> =>
    Object.entries(value).filter(([name]) => !overrides.has(name))

  mountCompiledPropTransition(
    binding,
    (initial) => {
      for (const [name, value] of visibleEntries(active(initial))) {
        cleanups.set(name, apply(name, value))
      }
    },
    (nextValue, previousValue) => {
      const next = active(nextValue)
      const previous = active(previousValue)
      const names = new Set([...Object.keys(previous), ...Object.keys(next)])
      const changes = [...names]
        .filter((name) => !overrides.has(name) && !Object.is(next[name], previous[name]))
        .map((name) => ({ name, next: next[name], previous: previous[name] }))
      const undo: Array<() => void> = []
      return [
        () => {
          for (const change of changes) {
            const previousCleanup = cleanups.get(change.name)
            let nextCleanup: () => void
            try {
              nextCleanup = apply(change.name, change.next)
            } catch (error) {
              try {
                apply(change.name, change.previous)
              } catch {
                // Preserve the spread property error that aborted publication.
              }
              throw error
            }
            try {
              previousCleanup?.()
            } catch (error) {
              nextCleanup()
              throw error
            }
            cleanups.set(change.name, nextCleanup)
            undo.push(() => {
              nextCleanup()
              cleanups.set(change.name, apply(change.name, change.previous))
            })
          }
        },
        () => {
          for (let index = undo.length - 1; index >= 0; index -= 1) undo[index]?.()
          undo.length = 0
        },
      ]
    },
  )
  registerCompiledCleanup(() => {
    controlledCleanup?.()
    for (const cleanup of cleanups.values()) cleanup()
  })
  return restoreAfterChildren
}
