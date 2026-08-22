import { useState } from 'react'

export function SynchronousControlFlow() {
  const [values, setValues] = useState([1, 2, 3])
  let total = 0
  for (const value of values) {
    if (value < 0) continue
    total += value
  }
  return <button onClick={() => setValues([4, 5])}>{total}</button>
}
