export function LocalRenderMutation() {
  const local = { value: 0 }
  local.value = 1
  return <p>{local.value}</p>
}
