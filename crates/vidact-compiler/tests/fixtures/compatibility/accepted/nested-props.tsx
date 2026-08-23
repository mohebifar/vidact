export function NestedProps({ account: { profile: { name: label = 'anonymous' } = {} } = {} }) {
  return <p>{label}</p>
}
