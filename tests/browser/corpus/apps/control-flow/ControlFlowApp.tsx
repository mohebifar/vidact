import { useReducer, useRef, useState } from 'react'

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

export function NestedListsApp(): JSX.Element {
  const [groups, setGroups] = useState([{ id: 'group', items: [{ id: 1, label: 'one' }] }])
  return (
    <section data-nested-lists>
      {groups.map((group) => (
        <article key={group.id} data-group={group.id}>
          {group.items.map((item) => (
            <output key={item.id} data-nested-row={item.id}>
              {item.label}
            </output>
          ))}
        </article>
      ))}
      <button
        data-update-nested
        onClick={() =>
          setGroups([
            {
              id: 'group',
              items: [
                { id: 1, label: 'ONE' },
                { id: 2, label: 'two' },
              ],
            },
          ])
        }
      >
        update nested
      </button>
    </section>
  )
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

const reactiveRefTrace: string[] = []

export function takeReactiveRefTrace(): string[] {
  return reactiveRefTrace.splice(0)
}

export function ReactiveRefApp(): JSX.Element {
  const [first, setFirst] = useState(false)
  const firstRef = (node: HTMLInputElement | null): (() => void) | void => {
    if (node === null) return
    reactiveRefTrace.push('attach:first')
    return () => reactiveRefTrace.push('clear:first')
  }
  const secondRef = (node: HTMLInputElement | null): (() => void) | void => {
    if (node === null) return
    reactiveRefTrace.push('attach:second')
    return () => reactiveRefTrace.push('clear:second')
  }
  return first ? (
    <input data-reactive-ref ref={firstRef} onClick={() => setFirst(false)} />
  ) : (
    <input data-reactive-ref ref={secondRef} onClick={() => setFirst(true)} />
  )
}

function FirstChoice(): JSX.Element {
  return <p data-slot-choice="first">first</p>
}

function SecondChoice(): JSX.Element {
  return <p data-slot-choice="second">second</p>
}

function ComponentSlot({ Type }: { Type: () => JSX.Element }): JSX.Element {
  return <Type />
}

export function SlotTypeApp(): JSX.Element {
  const [Type, setType] = useReducer(
    (_current: () => JSX.Element, next: () => JSX.Element) => next,
    FirstChoice,
  )
  return (
    <section data-slot-type-app>
      <ComponentSlot Type={Type} />
      <button
        data-slot-toggle
        onClick={() => setType(Type === FirstChoice ? SecondChoice : FirstChoice)}
      >
        toggle
      </button>
    </section>
  )
}
