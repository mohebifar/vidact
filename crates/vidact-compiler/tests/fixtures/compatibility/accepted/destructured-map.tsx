import { useState } from 'react'

export function DestructuredMap() {
  const [items, setItems] = useState([{ id: 1, label: 'one' }])
  return <ul>{items.map(({ id, label }) => <li key={id}>{label}</li>)}</ul>
}
