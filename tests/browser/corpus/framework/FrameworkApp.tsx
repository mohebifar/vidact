import { useState } from 'react'

export function FrameworkApp(): JSX.Element {
  const [count, setCount] = useState(0)
  return (
    <>
      <title>Framework {count}</title>
      <meta name="vidact-framework-count" content={`${count}`} />
      <main data-framework-app>
        <button data-increment onClick={() => setCount((value) => value + 1)}>
          increment
        </button>
        <output data-count>{count}</output>
      </main>
    </>
  )
}
