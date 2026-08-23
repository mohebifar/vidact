export function UntrackedDefaultProp({ name = 'world' }) {
  const upper = name.toUpperCase()
  return <p>{upper}</p>
}
