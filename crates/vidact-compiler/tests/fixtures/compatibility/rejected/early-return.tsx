import { useState } from 'react'

export function Early() {
  const [ready, setReady] = useState(false)
  if (!ready) return <button onClick={() => setReady(true)}>Load</button>
  return <p>Ready</p>
}
