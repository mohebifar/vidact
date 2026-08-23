import {
  hydrateCompiled,
  mountCompiled,
  type CompiledComponentResult,
  type MountCompiledOptions,
} from './compiled.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__

export interface CompiledRoot {
  readonly mount: (application: () => CompiledComponentResult) => void
  readonly replace: (application: () => CompiledComponentResult) => void
  readonly unmount: () => void
}

export interface HotContext {
  readonly data: Record<string, unknown>
  readonly accept: () => void
  readonly dispose: (callback: (data: Record<string, unknown>) => void) => void
  readonly prune: (callback: () => void) => void
}

const HOT_ROOT = '__vidactHotRoot'

export function createRoot(host: ParentNode, options?: MountCompiledOptions): CompiledRoot {
  let dispose: (() => void) | undefined
  let terminal = false
  return {
    mount(application) {
      if (terminal) throw new Error(DEV ? 'cannot mount an unmounted root' : 'V024')
      if (dispose !== undefined) {
        throw new Error(DEV ? 'compiled root already has a mounted application' : 'V025')
      }
      dispose = mountCompiled(application, host, options).dispose
    },
    replace(nextApplication) {
      if (terminal) throw new Error(DEV ? 'cannot replace an unmounted root' : 'V030')
      const previous = dispose
      const next = mountCompiled(nextApplication, host, options).dispose
      dispose = next
      previous?.()
    },
    unmount() {
      if (terminal) return
      terminal = true
      dispose?.()
      dispose = undefined
    },
  }
}

export function hydrateRoot(
  host: ParentNode,
  application: () => CompiledComponentResult,
  options?: MountCompiledOptions,
): CompiledRoot {
  let dispose: (() => void) | undefined = hydrateCompiled(application, host, options).dispose
  let terminal = false
  return {
    mount() {
      throw new Error(DEV ? 'hydration roots are mounted during creation' : 'V029')
    },
    replace(nextApplication) {
      if (terminal) throw new Error(DEV ? 'cannot replace an unmounted root' : 'V030')
      const previous = dispose
      const next = mountCompiled(nextApplication, host, options).dispose
      dispose = next
      previous?.()
    },
    unmount() {
      if (terminal) return
      terminal = true
      dispose?.()
      dispose = undefined
    },
  }
}

export function mountHotRoot(
  hot: HotContext,
  host: ParentNode,
  application: () => CompiledComponentResult,
  options?: MountCompiledOptions,
): CompiledRoot {
  const previous = hot.data[HOT_ROOT]
  const root = isCompiledRoot(previous) ? previous : createRoot(host, options)
  if (isCompiledRoot(previous)) root.replace(application)
  else root.mount(application)
  hot.data[HOT_ROOT] = root
  hot.accept()
  hot.dispose((data) => {
    data[HOT_ROOT] = root
  })
  hot.prune(() => {
    if (hot.data[HOT_ROOT] !== root) return
    delete hot.data[HOT_ROOT]
    root.unmount()
  })
  return root
}

function isCompiledRoot(value: unknown): value is CompiledRoot {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'replace') === 'function' &&
    typeof Reflect.get(value, 'unmount') === 'function'
  )
}
