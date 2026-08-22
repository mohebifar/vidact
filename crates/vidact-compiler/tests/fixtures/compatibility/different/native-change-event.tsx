import { useState } from 'react'

export function NativeChangeEvent() {
  const [value, setValue] = useState('')
  return <input value={value} onChange={(event) => setValue(event.currentTarget.value)} />
}
