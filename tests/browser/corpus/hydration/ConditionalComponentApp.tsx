import { useState } from 'react'

function Counter({ label }: { readonly label: string }) {
  const [count, setCount] = useState(0)
  return (
    <div data-panel="" data-count={count}>
      <button data-increment="" onClick={() => setCount(count + 1)}>
        {label}
      </button>
    </div>
  )
}

/** Two return sites, both components: the compiler wraps the output in a conditional. */
export function LeafRoute({ label, empty }: { readonly label: string; readonly empty?: boolean }) {
  if (empty) return <Counter label="empty" />
  return <Counter label={label} />
}

export function LayoutRoute({ children }: { readonly children?: JSX.Element }) {
  return <>{children}</>
}
