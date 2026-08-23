let shared = 0

export function GlobalUpdate() {
  shared++
  return <p>{shared}</p>
}
