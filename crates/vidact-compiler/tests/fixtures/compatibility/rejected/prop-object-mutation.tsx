export function PropObjectMutation({ user }) {
  user.name = 'changed'
  return <p>{user.name}</p>
}
