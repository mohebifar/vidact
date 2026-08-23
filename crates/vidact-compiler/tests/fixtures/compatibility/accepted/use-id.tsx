import { useId } from 'react'

export function IdentifiedField() {
  const inputId = useId()
  const hintId = useId()
  return (
    <>
      <label htmlFor={inputId}>Name</label>
      <input id={inputId} aria-describedby={hintId} />
      <small id={hintId}>Required</small>
    </>
  )
}
