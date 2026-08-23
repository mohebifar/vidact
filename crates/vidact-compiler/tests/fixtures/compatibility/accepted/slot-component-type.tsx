function One() {
  return <p>one</p>
}

export function SlotComponentType({ Type }) {
  return <Type />
}

export function App() {
  return <SlotComponentType Type={One} />
}
