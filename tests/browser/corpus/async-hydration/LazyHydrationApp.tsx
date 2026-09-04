import { Suspense, lazy, useState } from 'react'

type PanelModule = { readonly default: typeof LazyPanel }

let resolvePanelModule!: (module: PanelModule) => void

/** Stands in for a code-split chunk the server had, but the client has not fetched yet. */
export const panelModule = new Promise<PanelModule>((resolve) => {
  resolvePanelModule = resolve
})

export function revealPanel(): void {
  resolvePanelModule({ default: LazyPanel })
}

function LazyPanel({ count }: { readonly count: number }) {
  return (
    <section data-panel="" data-count={count}>
      panel
    </section>
  )
}

const Panel = lazy(() => panelModule)

export function LazyHydrationApp() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <button data-increment="" onClick={() => setCount(count + 1)}>
        increment
      </button>
      <Suspense fallback={<p data-fallback="">loading</p>}>
        <Panel count={count} />
      </Suspense>
    </div>
  )
}
