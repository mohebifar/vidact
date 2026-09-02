import { useState } from 'react'

export function App(): JSX.Element {
  const [count, setCount] = useState(0)

  return (
    <main className="app">
      <p className="eyebrow">Compiled by Vidact</p>
      <h1>React in, DOM out.</h1>
      <p className="lede">
        This component is written as React and compiled to direct DOM operations. No virtual DOM
        ships to the browser.
      </p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Clicked {count} {count === 1 ? 'time' : 'times'}
      </button>
      <p className="hint">
        Edit <code>src/App.tsx</code> and save to see the update.
      </p>
    </main>
  )
}
