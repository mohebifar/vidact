import { Profiler, useState } from 'react'

const phases: Array<'mount' | 'update' | 'nested-update'> = []

export function readHydrationProfilePhases(): readonly string[] {
  return phases
}

export function resetHydrationProfilePhases(): void {
  phases.length = 0
}

function HydratedCounter(): JSX.Element {
  const [count, setCount] = useState(0)
  return (
    <section data-hydrated-profile>
      <button data-increment onClick={() => setCount((value) => value + 1)}>
        increment
      </button>
      <output data-count>{count}</output>
    </section>
  )
}

export function ProfilingHydrationApp(): JSX.Element {
  return (
    <main>
      <Profiler id="hydrated" onRender={(_id, phase) => phases.push(phase)}>
        <HydratedCounter />
      </Profiler>
    </main>
  )
}
