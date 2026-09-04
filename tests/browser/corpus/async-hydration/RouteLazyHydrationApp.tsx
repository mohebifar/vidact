import { Suspense, lazy, useState } from 'react'

type PanelModule = { readonly default: typeof RoutePanel }

let resolveRouteModule!: (module: PanelModule) => void

export const routePanelModule = new Promise<PanelModule>((resolve) => {
  resolveRouteModule = resolve
})

export function revealRoutePanel(): void {
  resolveRouteModule({ default: RoutePanel })
}

function RoutePanel({ label }: { readonly label: string }) {
  const [count, setCount] = useState(0)
  return (
    <div data-panel="" data-count={count}>
      <button data-increment="" onClick={() => setCount(count + 1)}>
        {label}
      </button>
    </div>
  )
}

const Panel = lazy(() => routePanelModule)

/**
 * Mirrors a router: a layout that forwards `children` through a fragment, and a leaf
 * route whose entire output is a Suspense boundary around a lazy component.
 */
export function LeafRoute({ label, empty }: { readonly label: string; readonly empty?: boolean }) {
  // Two return sites: the compiler wraps the component output in a conditional.
  if (empty) return <p data-empty="">nothing to load</p>
  return (
    <Suspense fallback={<p data-fallback="">loading</p>}>
      <Panel label={label} />
    </Suspense>
  )
}

export function LayoutRoute({ children }: { readonly children?: JSX.Element }) {
  return <>{children}</>
}

export function RouteLazyHydrationApp({ label }: { readonly label: string }) {
  return (
    <LayoutRoute>
      <LeafRoute label={label} />
    </LayoutRoute>
  )
}
