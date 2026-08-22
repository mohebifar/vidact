export function Ternary({ ready }) {
  return ready ? <p data-state="ready">Ready</p> : <p data-state="waiting">Waiting</p>
}

export function Logical({ value }) {
  return value || <span>Fallback</span>
}

export function Nullish({ value }) {
  return value ?? <span>Fallback</span>
}

export function TerminalSwitch({ mode }) {
  switch (mode) {
    case 'loading':
      return <button>Load</button>
    case 'ready':
      return <p>Ready</p>
    default:
      return null
  }
}
