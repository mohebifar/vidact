import { useState } from 'react'

export function Counter(): JSX.Element {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount((value) => value + 1)}>{count}</button>
}
