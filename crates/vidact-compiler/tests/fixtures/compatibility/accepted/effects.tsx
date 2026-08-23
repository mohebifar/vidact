import { useEffect, useLayoutEffect, useState } from 'react'

export function Effects() {
  const [count, setCount] = useState(0)
  useLayoutEffect(() => () => console.log(count), [count])
  useEffect(() => console.log(count), [count])
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
