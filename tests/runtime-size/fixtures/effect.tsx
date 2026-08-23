import { useEffect, useState } from 'react'

export function EffectFixture(): JSX.Element {
  const [count, setCount] = useState(0)
  useEffect(() => {
    document.title = String(count)
  }, [count])
  return <button onClick={() => setCount((value) => value + 1)}>{count}</button>
}
