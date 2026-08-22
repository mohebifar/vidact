import { useState } from 'react'

export function TryExplicitThrow(): JSX.Element {
  const [broken, setBroken] = useState(false)
  let label = 'ready'
  try {
    if (broken) throw new Error('broken')
  } catch (error) {
    label = error instanceof Error ? error.message : 'unknown'
  }
  return <button onClick={() => setBroken(true)}>{label}</button>
}
