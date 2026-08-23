import { useRef, useState } from 'react'

export function BranchVaryingRef() {
  const first = useRef(null)
  const second = useRef(null)
  const [ready, setReady] = useState(false)
  return ready ? <input ref={first} /> : <input ref={second} />
}
