import { useRef } from 'react'

function Input({ ref }: { ref: { current: HTMLInputElement | null } }) {
  return <input ref={ref} />
}

export function RefAsProp() {
  const input = useRef<HTMLInputElement | null>(null)
  return <Input ref={input} />
}
