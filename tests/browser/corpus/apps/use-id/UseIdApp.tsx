import { useId, useState } from 'react'

function Field({ name }: { readonly name: string }): JSX.Element {
  const inputId = useId()
  const hintId = useId()
  return (
    <fieldset data-field={name}>
      <label htmlFor={inputId}>{name}</label>
      <input id={inputId} aria-describedby={hintId} />
      <small id={hintId}>Hint for {name}</small>
    </fieldset>
  )
}

export default function UseIdApp(): JSX.Element {
  const [count, setCount] = useState(0)
  const [showLate, setShowLate] = useState(false)

  return (
    <section>
      <Field name="initial" />
      {showLate && <Field name="late" />}
      <output data-count={count}>{count}</output>
      <button data-increment onClick={() => setCount(count + 1)}>
        Increment
      </button>
      <button data-toggle-late onClick={() => setShowLate((visible) => !visible)}>
        Toggle late field
      </button>
    </section>
  )
}
