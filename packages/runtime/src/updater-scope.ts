import {
  intersectsSources,
  isEmptySources,
  type SourceMask,
  unionSources,
} from './source-mask.ts'

const MAX_FLUSH_PASSES = 100

export interface StaticUpdater {
  readonly reads: SourceMask
  readonly writes?: SourceMask
  readonly run: () => void
}

export interface UpdaterScope {
  readonly batch: <T>(operation: () => T) => T
  readonly dispose: () => void
  readonly invalidate: (sources: SourceMask) => void
}

export function createUpdaterScope(updaters: readonly StaticUpdater[]): UpdaterScope {
  let batchDepth = 0
  let disposed = false
  let flushing = false
  let pending: SourceMask = 0

  const flush = (): void => {
    if (disposed || flushing) return
    flushing = true
    try {
      let pass = 0
      while (!isEmptySources(pending)) {
        pass += 1
        if (pass > MAX_FLUSH_PASSES) {
          pending = 0
          throw new Error('Vidact updater scope did not stabilize')
        }

        let active = pending
        pending = 0

        for (const updater of updaters) {
          if (!intersectsSources(active, updater.reads)) continue

          updater.run()
          if (updater.writes !== undefined) {
            active = unionSources(active, updater.writes)
          }
        }
      }
    } finally {
      flushing = false
    }
  }

  const invalidate = (sources: SourceMask): void => {
    if (disposed || isEmptySources(sources)) return
    pending = unionSources(pending, sources)
    if (batchDepth === 0) flush()
  }

  const batch = <T>(operation: () => T): T => {
    batchDepth += 1
    try {
      return operation()
    } finally {
      batchDepth -= 1
      if (batchDepth === 0) flush()
    }
  }

  const dispose = (): void => {
    disposed = true
    pending = 0
  }

  return { batch, dispose, invalidate }
}
