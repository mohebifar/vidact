import { flushSync } from 'react-dom'

flushSync(() => {})

export function StaticFlush(): Node {
  return <p>static</p>
}
