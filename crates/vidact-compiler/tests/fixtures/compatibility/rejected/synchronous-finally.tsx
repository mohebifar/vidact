import { useState } from 'react'

export function SynchronousFinally(): JSX.Element {
  const [mode, setMode] = useState('normal')
  let label = ''
  try {
    label = mode
  } finally {
    label += '!'
  }
  return <button onClick={() => setMode('next')}>{label}</button>
}
