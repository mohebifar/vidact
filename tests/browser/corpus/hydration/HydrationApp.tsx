import { createContext, useId, useState } from 'react'

type Item = {
  readonly id: number
  readonly label: string
}

const Theme = createContext('default')

export function HydrationApp({ initialItems }: { readonly initialItems: readonly Item[] }) {
  return (
    <Theme.Provider value="red">
      <HydrationContent initialItems={initialItems} />
    </Theme.Provider>
  )
}

function HydrationContent({
  initialItems,
}: {
  readonly initialItems: readonly Item[]
}): JSX.Element {
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
