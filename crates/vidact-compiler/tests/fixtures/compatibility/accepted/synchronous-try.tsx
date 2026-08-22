import { useState } from 'react'

function readMode(mode: string): string {
  if (mode === 'caught') throw new Error('caught')
  return mode
}

export function SynchronousTry(): JSX.Element {
  const [mode, setMode] = useState('normal')
  let label = ''
  try {
    label = readMode(mode)
  } catch (error) {
    label = error instanceof Error ? error.message : 'unknown'
  }
  return <button onClick={() => setMode('caught')}>{label}</button>
}
