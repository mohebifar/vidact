import { useActionState } from 'react'

export function DisabledAction() {
  const [value] = useActionState(async () => 'next', 'initial')
  return <p>{value}</p>
}
