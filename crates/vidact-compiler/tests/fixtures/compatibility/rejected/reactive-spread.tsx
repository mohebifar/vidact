import { useState } from 'react'

export function ReactiveSpread() {
  const [attributes] = useState({ title: 'first' })
  return <div {...attributes}>value</div>
}
