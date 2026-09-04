export function LocalRenderMutation() {
  const local = { value: 0 }
  local.value = 1
  let count = 0
  count = local.value + 1
  return <p>{local.value}:{count}</p>
}
