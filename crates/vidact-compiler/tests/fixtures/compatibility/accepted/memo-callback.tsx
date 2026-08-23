import { useCallback, useMemo, useState } from 'react'

export function MemoCallback() {
  const [count, setCount] = useState(0)
  const doubled = useMemo(() => count * 2, [count])
  const increment = useCallback(() => setCount(count + 1), [count])

  return <button onClick={increment}>{doubled}</button>
}
