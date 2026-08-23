import { useId, useState } from 'react'

type Item = {
  readonly id: number
  readonly label: string
}

export function HydrationApp({ initialItems }: { readonly initialItems: readonly Item[] }) {
  const [items, setItems] = useState(initialItems)
  const labelId = useId()
  return (
    <section>
      <h1 id={labelId}>Hydrated list</h1>
      <button onClick={() => setItems((current) => [current[1]!, current[0]!])}>Reverse</button>
      <ul aria-labelledby={labelId}>
        {items.map((item) => (
          <li key={item.id}>{item.label}</li>
        ))}
      </ul>
    </section>
  )
}
