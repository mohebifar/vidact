import { Suspense, use } from 'react'

let resolveMessage!: (value: string) => void

export const message = new Promise<string>((resolve) => {
  resolveMessage = resolve
})

export function revealMessage(): void {
  resolveMessage('ready')
}

function AsyncMessage() {
  return <strong data-content="">{use(message)}</strong>
}

export function AsyncHydrationApp() {
  return (
    <Suspense fallback={<p data-fallback="">loading</p>}>
      <AsyncMessage />
    </Suspense>
  )
}
