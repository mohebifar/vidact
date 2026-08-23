import { useState } from 'react'

export function KeyedList(): JSX.Element {
  const [items, setItems] = useState([
    { id: 1, label: 'one' },
    { id: 2, label: 'two' },
  ])
  return (
    <button onClick={() => setItems((values) => values.toReversed())}>
      {items.map((item) => (
        <span key={item.id}>{item.label}</span>
      ))}
    </button>
  )
}
