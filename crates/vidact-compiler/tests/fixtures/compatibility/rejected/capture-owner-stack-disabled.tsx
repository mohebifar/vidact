import { captureOwnerStack } from 'react'

export function OwnerStackDisabled(): Node {
  return <p data-owner={captureOwnerStack()}>disabled</p>
}
