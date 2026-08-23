import { useState } from 'react'

export function ReactiveSpread() {
  const [attributes, setAttributes] = useState({ title: 'first' })
  return <div {...attributes}>value</div>
}
