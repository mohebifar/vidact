import { errorBoundary } from '@vidact/runtime'

function Child({ value }: { value: string }) {
  return <output>{value}</output>
}

export function FunctionErrorBoundary({ value }: { value: string }) {
  return errorBoundary(
    () => <Child value={value} />,
    (error) => <p>{String(error)}</p>,
  )
}
