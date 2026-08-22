import { useState } from 'react'

export function IterativeJsxArrays(): JSX.Element {
  const [items, setItems] = useState([{ id: 'one', label: 'One' }])
  const rows = []
  for (const item of items) {
    rows.push(<li key={item.id}>{item.label}</li>)
  }
  return (
    <section>
      <ul>{rows}</ul>
      <button onClick={() => setItems((current) => current.toReversed())}>reverse</button>
    </section>
  )
}
