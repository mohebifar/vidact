import { useState } from 'react'
import { preconnect } from 'react-dom'

export interface FrameworkHydrationAppProps {
  readonly initialCount?: number
}

export function FrameworkHydrationApp({
  initialCount = 0,
}: FrameworkHydrationAppProps = {}): JSX.Element {
  const [count, setCount] = useState(initialCount)
  preconnect('https://assets.example.test', { crossOrigin: 'anonymous' })
  return (
    <section data-framework-boundary>
      <button data-increment onClick={() => setCount((value) => value + 1)}>
        increment
      </button>
      <output data-count>{count}</output>
    </section>
  )
}
