import { useState } from 'react'

function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div data-panel="">
      <button data-increment="" onClick={() => setCount(count + 1)}>
        {count}
      </button>
    </div>
  )
}

const ITEMS = ['one', 'two'] as const

/**
 * A wrapper whose only child is a conditional (a structural binding), followed by a
 * sibling of the same tag that holds a keyed list. The wrapper has no class or id, so
 * only its `data-host` attribute tells it apart — and the list sibling must not be
 * preferred just because it contains an array marker.
 */
export function ElementClaimApp({ empty }: { readonly empty?: boolean }) {
  return (
    <section>
      <div data-host="">{empty ? <p data-empty="">nothing</p> : <Counter />}</div>
      <div className="toolbar">
        {ITEMS.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  )
}
