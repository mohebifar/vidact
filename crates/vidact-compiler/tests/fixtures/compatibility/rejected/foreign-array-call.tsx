declare function createTuple(): [string]

export function ForeignArrayCall() {
  const [value] = createTuple()
  return <p>{value}</p>
}
