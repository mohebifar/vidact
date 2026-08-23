import { Suspense, use } from 'react'

const message = Promise.resolve('ready')

function AsyncMessage() {
  return <strong>{use(message)}</strong>
}

export function AsyncSuspense() {
  return (
    <Suspense fallback={<p>loading</p>}>
      <AsyncMessage />
    </Suspense>
  )
}
