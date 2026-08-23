import { useState } from 'react'

export function ReactChangeEvent() {
  const [value, setValue] = useState('')
  return <input value={value} onChange={(event) => setValue(event.currentTarget.value)} />
}
