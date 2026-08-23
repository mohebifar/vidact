import { useEffect, useMemo, useState } from 'react'

function useCounter(initial: number) {
  const [count, setCount] = useState(initial)
  const doubled = useMemo(() => count * 2, [count])
  useEffect(() => () => console.log(count), [count])
  return { count, doubled, setCount }
}

export function CustomHooks(): JSX.Element {
  const { count, doubled, setCount } = useCounter(1)
  return <button onClick={() => setCount(count + 1)}>{doubled}</button>
}
