import { useState } from 'react'

export function DomForm() {
  const [value, setValue] = useState('ready')
  return <input value={value} onChange={() => setValue('changed')} />
}
