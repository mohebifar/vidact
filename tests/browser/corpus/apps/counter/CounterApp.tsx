import { useReducer } from 'react'

type CounterAction = { readonly type: 'decrement' } | { readonly type: 'increment' }

function countReducer(count: number, action: CounterAction): number {
  return action.type === 'increment' ? count + 1 : Math.max(0, count - 1)
}

export function CounterApp(): JSX.Element {
  const [count, dispatch] = useReducer(countReducer, 0, (initial) => initial)
  const doubled = count * 2

  return (
    <section className="counter-app" data-count={count}>
      <button data-action="decrement" onClick={() => dispatch({ type: 'decrement' })}>
        Decrement
      </button>
      <output aria-label="Current count">
        <strong className="count">{count}</strong>
        <span className="doubled" data-doubled={doubled}>
          {doubled}
        </span>
      </output>
      <button data-action="increment" onClick={() => dispatch({ type: 'increment' })}>
        Increment
      </button>
      {count > 0 && <p className="positive">Positive</p>}
    </section>
  )
}
