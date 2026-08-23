import { use } from 'react'

export function PromiseUseDisabled() {
  const message = use(Promise.resolve('ready'))
  return <strong>{message}</strong>
}
