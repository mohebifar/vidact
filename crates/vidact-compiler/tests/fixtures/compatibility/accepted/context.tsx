import * as React from 'react'
import { createContext, useContext } from 'react'

const Theme = createContext('light')

function NamedConsumer() {
  const theme = useContext(Theme)
  return <span>{theme}</span>
}

function UseConsumer() {
  const theme = React.use(Theme)
  return <strong>{theme}</strong>
}

export function ContextApp() {
  return (
    <Theme value="dark">
      <NamedConsumer />
      <UseConsumer />
    </Theme>
  )
}
