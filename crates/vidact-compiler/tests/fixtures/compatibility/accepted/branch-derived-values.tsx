import { useState } from 'react'

export function BranchDerived({ first, second }: { first: string; second: string }) {
  const [alternate, setAlternate] = useState(false)
  let selected
  if (alternate) {
    selected = second
  } else {
    selected = first
  }
  return <p title={selected} onClick={() => setAlternate((value) => !value)}>{selected}</p>
}
