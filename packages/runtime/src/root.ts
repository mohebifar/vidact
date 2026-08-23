import {
  hydrateCompiled,
  mountCompiled,
  type CompiledComponentResult,
  type MountCompiledOptions,
} from './compiled.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__

export interface CompiledRoot {
  readonly mount: (application: () => CompiledComponentResult) => void
  readonly unmount: () => void
}

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
    unmount() {
      if (terminal) return
      terminal = true
      dispose?.()
      dispose = undefined
    },
  }
}
