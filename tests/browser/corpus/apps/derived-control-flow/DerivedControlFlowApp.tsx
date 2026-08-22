import { useState } from 'react'

interface Choice {
  readonly label: string
  readonly rows: readonly { readonly id: string; readonly label: string }[]
}

export function DerivedControlFlowApp(): JSX.Element {
  const [alternate, setAlternate] = useState(false)
  const [first, setFirst] = useState<Choice>({
    label: 'first',
    rows: [{ id: 'stable', label: 'first row' }],
  })
  const [second, setSecond] = useState<Choice>({
    label: 'second',
    rows: [{ id: 'stable', label: 'second row' }],
  })

  let selected
  if (alternate) {
    selected = second
  } else {
    selected = first
  }

  return (
    <section data-derived-flow title={selected.label}>
      <output data-selected>{selected.label}</output>
      <ul>
        {selected.rows.map((row) => (
          <li key={row.id} data-derived-row>
            {row.label}
          </li>
        ))}
      </ul>
      <button data-toggle onClick={() => setAlternate((value) => !value)}>
        toggle
      </button>
      <button
        data-update-first
        onClick={() =>
          setFirst((value) => ({
            label: `${value.label}!`,
            rows: value.rows.map((row) => ({ ...row, label: `${row.label}!` })),
          }))
        }
      >
        update first
      </button>
      <button
        data-update-second
        onClick={() =>
          setSecond((value) => ({
            label: `${value.label}!`,
            rows: value.rows.map((row) => ({ ...row, label: `${row.label}!` })),
          }))
        }
      >
        update second
      </button>
      <button data-noop onClick={() => setFirst((value) => value)}>
        noop
      </button>
      <button
        data-batch
        onClick={() => {
          setSecond({ label: 'batched', rows: [{ id: 'stable', label: 'batched row' }] })
          setAlternate(true)
        }}
      >
        batch
      </button>
    </section>
  )
}

function FirstType({ toggle }: { toggle: () => void }): JSX.Element {
  const [count, setCount] = useState(0)
  return (
    <section data-first-type>
      <button data-type-increment onClick={() => setCount((value) => value + 1)}>
        first:{count}
      </button>
      <button data-type-toggle onClick={toggle}>
        toggle type
      </button>
    </section>
  )
}

function SecondType({ toggle }: { toggle: () => void }): JSX.Element {
  const [count, setCount] = useState(0)
  return (
    <section data-second-type>
      <button data-type-increment onClick={() => setCount((value) => value + 1)}>
        second:{count}
      </button>
      <button data-type-toggle onClick={toggle}>
        toggle type
      </button>
    </section>
  )
}

export function DerivedTypeFlowApp(): JSX.Element {
  const [alternate, setAlternate] = useState(false)
  let Type
  if (alternate) {
    Type = SecondType
  } else {
    Type = FirstType
  }
  return <Type toggle={() => setAlternate((value) => !value)} />
}
