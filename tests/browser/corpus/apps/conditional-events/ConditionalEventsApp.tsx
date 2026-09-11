import { useState } from 'react'

interface Row {
  readonly id: string
  readonly type: 'a' | 'b'
}

function A({ onClick }: { readonly onClick: () => void }): JSX.Element {
  return (
    <button data-row-id="first" data-row-type="a" onClick={onClick}>
      A
    </button>
  )
}

function B({ id, onClick }: { readonly id: string; readonly onClick: () => void }): JSX.Element {
  return (
    <button data-row-id={id} data-row-type="b" onClick={onClick}>
      B
    </button>
  )
}

export function ConditionalEventsApp(): JSX.Element {
  const [alternate, setAlternate] = useState(false)
  const [eventTrace, setEventTrace] = useState('')
  const [rows, setRows] = useState<readonly Row[]>([
    { id: 'first', type: 'a' },
    { id: 'stable', type: 'b' },
  ])

  const handleClick1 = (): void => setEventTrace((trace) => `${trace}1`)
  const handleClick2 = (): void => setEventTrace((trace) => `${trace}2`)
  const handler1 = (): void => setEventTrace((trace) => `${trace}a`)
  const handler2 = (): void => setEventTrace((trace) => `${trace}b`)

  return (
    <main data-conditional-events-app>
      <output data-event-trace>{eventTrace}</output>
      <button data-conditional-event onClick={alternate ? handleClick1 : handleClick2}>
        conditional event
      </button>
      <button data-switch-event onClick={() => setAlternate((value) => !value)}>
        switch event
      </button>
      <button
        data-switch-row
        onClick={() =>
          setRows((current) =>
            current.map((row) =>
              row.id === 'first'
                ? { ...row, type: row.type === 'a' ? ('b' as const) : ('a' as const) }
                : row,
            ),
          )
        }
      >
        switch row
      </button>
      <section data-rows>
        {rows.map((row) =>
          row.type === 'a' ? (
            <A key={row.id} onClick={handler1} />
          ) : (
            <B key={row.id} id={row.id} onClick={handler2} />
          ),
        )}
      </section>
    </main>
  )
}
