import { useReducer } from 'react'

export function ReducerCounter() {
  const [count, dispatch] = useReducer((value: number, amount: number) => value + amount, 0)
  return <button onClick={() => dispatch(1)}>{count}</button>
}
