import { useState } from 'react'

export function ControlFlow(): JSX.Element {
  const [visible, setVisible] = useState(true)
  return (
    <button onClick={() => setVisible((value) => !value)}>{visible && <span>visible</span>}</button>
  )
}
