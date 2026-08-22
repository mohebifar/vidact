import { useState } from 'react'

export function CounterApp(): JSX.Element {
  const [count, setCount] = useState(0)
  const doubled = count * 2

  return (
    <section className="counter-app" data-count={count}>
      <button
        data-action="decrement"
        onClick={() => setCount((current) => Math.max(0, current - 1))}
      >
        Decrement
      </button>
      <output aria-label="Current count">
        <strong className="count">{count}</strong>
        <span className="doubled" data-doubled={doubled}>
          {doubled}
        </span>
      </output>
      <button data-action="increment" onClick={() => setCount((current) => current + 1)}>
        Increment
      </button>
      {count > 0 && <p className="positive">Positive</p>}
    </section>
  )
}
