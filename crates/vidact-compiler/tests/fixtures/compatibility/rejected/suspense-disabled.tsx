import { Suspense } from 'react'

export function SuspenseDisabled() {
  return <Suspense fallback={<p>loading</p>}>content</Suspense>
}
