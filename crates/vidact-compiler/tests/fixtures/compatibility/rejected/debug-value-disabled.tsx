import { useDebugValue } from 'react'

export function DebugValueDisabled(): Node {
  useDebugValue('disabled')
  return <p>disabled</p>
}
