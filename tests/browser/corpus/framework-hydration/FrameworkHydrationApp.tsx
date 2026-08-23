import { useState } from 'react'
import { preconnect } from 'react-dom'

export function FrameworkHydrationApp(): JSX.Element {
  const [count, setCount] = useState(0)
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
