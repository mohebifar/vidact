import * as React from 'react'

type PossibleRef<T> = React.Ref<T> | undefined

const trace: string[] = []

function record(name: string): React.RefCallback<HTMLInputElement> {
  return (node) => {
    trace.push(`${name}:${node === null ? 'detach' : 'attach'}`)
  }
}

const primaryRef = record('primary')
const secondaryRef = record('secondary')
const authoredRef = record('authored')

export function readComposedRefTrace(): readonly string[] {
  return [...trace]
}

export function resetComposedRefTrace(): void {
  trace.length = 0
}

function setRef<T>(ref: PossibleRef<T>, value: T | null): void | (() => void) {
  if (typeof ref === 'function') {
    return ref(value)
  }
  if (ref !== null && ref !== undefined) {
    ref.current = value
  }
}

function composeRefs<T>(...refs: PossibleRef<T>[]): React.RefCallback<T> {
  return (node) => {
    let hasCleanup = false
    const cleanups = refs.map((ref) => {
      const cleanup = setRef(ref, node)
      if (!hasCleanup && typeof cleanup === 'function') {
        hasCleanup = true
      }
      return cleanup
    })

    if (hasCleanup) {
      return () => {
        for (let index = 0; index < cleanups.length; index += 1) {
          const cleanup = cleanups[index]
          if (typeof cleanup === 'function') {
            cleanup()
          } else {
            setRef(refs[index], null)
          }
        }
      }
    }
  }
}

function useComposedRefs<T>(...refs: PossibleRef<T>[]): React.RefCallback<T> {
  return React.useCallback(composeRefs(...refs), refs)
}

function RefTarget({ externalRef }: { readonly externalRef: React.Ref<HTMLInputElement> }) {
  const composedRef = useComposedRefs(externalRef, authoredRef)
  return <input data-composed-ref ref={composedRef} defaultValue="retained" />
}

export default function ComposedRefsApp(): JSX.Element {
  const [secondary, setSecondary] = React.useState(false)

  return (
    <main>
      <button data-switch-ref onClick={() => setSecondary(!secondary)}>
        Switch ref
      </button>
      <RefTarget externalRef={secondary ? secondaryRef : primaryRef} />
    </main>
  )
}
