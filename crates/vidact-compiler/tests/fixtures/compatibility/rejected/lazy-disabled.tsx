import { lazy } from 'react'

const Deferred = lazy(() => import('./deferred'))

export function LazyDisabled() {
  return <Deferred />
}
