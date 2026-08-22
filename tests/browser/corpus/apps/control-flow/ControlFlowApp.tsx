import { useRef, useState } from 'react'

function Counter({ label }: { label: string }): JSX.Element {
  const [count, setCount] = useState(0)
  const input = useRef<HTMLInputElement | null>(null)
  const items = [{ id: 'stable', label: 'retained row' }]
  return (
    <section data-counter data-label={label}>
      <button data-counter-increment onClick={() => setCount((value) => value + 1)}>
        {label}:{count}
      </button>
      <input data-counter-input ref={input} />
      <ul>
        {items.map((item) => (
          <li key={item.id} data-counter-row>
            {item.label}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ControlFlowApp(): JSX.Element {
  const [mode, setMode] = useState<'first' | 'second' | 'other'>('first')

  if (mode === 'other') {
    return (
      <p data-other>
        other
        <button data-return onClick={() => setMode('first')}>
          return
        </button>
      </p>
    )
  }

  return mode === 'first' ? (
    <section data-shell data-mode="first" aria-label="first mode">
      <Counter label="first" />
      <button data-toggle onClick={() => setMode('second')}>
        toggle
      </button>
      <button data-show-other onClick={() => setMode('other')}>
        other
      </button>
    </section>
  ) : (
    <section data-shell data-mode="second">
      <Counter label="second" />
      <button data-toggle onClick={() => setMode('first')}>
        toggle
      </button>
      <button data-show-other onClick={() => setMode('other')}>
        other
      </button>
    </section>
  )
}

export function LogicalFlowApp(): JSX.Element {
  const [value, setValue] = useState<number | null>(0)
  return (
    <section data-logical-flow>
      <output data-and>{value && <i>and</i>}</output>
      <output data-or>{value || <i>or</i>}</output>
      <output data-nullish>{value ?? <i>nullish</i>}</output>
      <button data-two onClick={() => setValue(2)}>
        two
      </button>
      <button data-null onClick={() => setValue(null)}>
        null
      </button>
      <button data-noop onClick={() => setValue((current) => current)}>
        noop
      </button>
    </section>
  )
}

function KeyedCounter({ swap }: { swap: () => void }): JSX.Element {
  const [count, setCount] = useState(0)
  return (
    <section data-keyed-counter>
      <output data-keyed-count>{count}</output>
      <button data-keyed-increment onClick={() => setCount((current) => current + 1)}>
        increment
      </button>
      <button data-keyed-swap onClick={swap}>
        swap
      </button>
    </section>
  )
}

export function KeyedControlFlowApp(): JSX.Element {
  const [key, setKey] = useState<'a' | 'b'>('a')
  return <KeyedCounter key={key} swap={() => setKey((current) => (current === 'a' ? 'b' : 'a'))} />
}

export function SwitchFlowApp(): JSX.Element {
  const [mode, setMode] = useState<'a' | 'b'>('a')
  switch (mode) {
    case 'a':
      return (
        <section data-switch-a>
          A
          <button data-switch-next onClick={() => setMode('b')}>
            next
          </button>
        </section>
      )
    case 'b':
      return (
        <article data-switch-b>
          B
          <button data-switch-next onClick={() => setMode('a')}>
            next
          </button>
        </article>
      )
    default:
      return <></>
  }
}
