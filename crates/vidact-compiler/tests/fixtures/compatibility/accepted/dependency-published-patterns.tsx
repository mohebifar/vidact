import * as React from 'react'

const PublishedReact = { ...React }
const PublishedContext = React.createContext('published')

function readContext(value: string): string {
  return value.toUpperCase()
}

function usePublishedState({ disabled = false }: { disabled?: boolean } = {}) {
  const [, setPressed] = PublishedReact.useState(false)
  const label = readContext(PublishedReact.useContext(PublishedContext))
  const id = typeof PublishedReact.useId === 'function' ? PublishedReact.useId() : undefined
  PublishedReact.useEffect(() => setPressed(!disabled), [disabled, setPressed])
  return { id, label, setPressed }
}

export function DependencyPublishedPatterns({ disabled = false }) {
  const { id, label, setPressed } = usePublishedState({ disabled })
  return React.createElement(
    'button',
    {
      disabled,
      id,
      onClick: () => setPressed(true),
    },
    label,
  )
}
