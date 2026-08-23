import { createContext, use, useContext, useState } from 'react'

const Theme = createContext('default')

function Consumer({ name }: { readonly name: string }): JSX.Element {
  const theme = useContext(Theme)
  return (
    <output data-context={name} data-value={theme}>
      {theme}
    </output>
  )
}

function UseConsumer(): JSX.Element {
  const theme = use(Theme)
  return (
    <output data-context="nested" data-value={theme}>
      {theme}
    </output>
  )
}

export default function ContextApp(): JSX.Element {
  const [theme, setTheme] = useState('red')
  const [showLateConsumer, setShowLateConsumer] = useState(false)

  return (
    <section>
      <Consumer name="default" />
      <Theme value={theme}>
        <Consumer name="outer" />
        {showLateConsumer && <Consumer name="late" />}
        <Theme.Provider value="nested">
          <UseConsumer />
        </Theme.Provider>
      </Theme>
      <button data-toggle-late onClick={() => setShowLateConsumer((visible) => !visible)}>
        Toggle late consumer
      </button>
      <button
        data-toggle-theme
        onClick={() => setTheme((value) => (value === 'red' ? 'blue' : 'red'))}
      >
        Toggle theme
      </button>
    </section>
  )
}
