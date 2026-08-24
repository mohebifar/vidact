import { Suspense, use, useState } from 'react'

let resolveMessage!: (value: string) => void
let resolveNextMessage!: (value: string) => void

export const message = new Promise<string>((resolve) => {
  resolveMessage = resolve
})
export const nextMessage = new Promise<string>((resolve) => {
  resolveNextMessage = resolve
})

export function revealMessage(): void {
  resolveMessage('ready')
}

export function revealNextMessage(): void {
  resolveNextMessage('updated')
}

function AsyncMessage({
  count,
  messagePromise,
}: {
  readonly count: number
  readonly messagePromise: PromiseLike<string>
}) {
  return (
    <div data-content="" data-count={count}>
      <strong>{use(messagePromise)}</strong>
    </div>
  )
}

export function AsyncHydrationApp() {
  const [count, setCount] = useState(0)
  const [messageRequest, setMessageRequest] = useState(message)

  return (
    <div>
      <button data-increment="" onClick={() => setCount(count + 1)}>
        increment
      </button>
      <button data-refresh="" onClick={() => setMessageRequest(nextMessage)}>
        refresh
      </button>
      {count < 10 && (
        <div data-inline-conditional="">
          <p>inside conditional</p>
        </div>
      )}
      <p data-after-conditional="">after conditional</p>
      <Suspense fallback={<p data-fallback="">loading</p>}>
        <AsyncMessage count={count} messagePromise={messageRequest} />
      </Suspense>
    </div>
  )
}
