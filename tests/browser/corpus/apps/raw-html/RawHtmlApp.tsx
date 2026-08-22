import { useState } from 'react'

type Mode = 'one' | 'same' | 'two'

function htmlFor(mode: Mode): string {
  if (mode === 'two') return '<em data-version="two">Two</em>'
  return '<strong data-version="one">One</strong>'
}

export function RawHtmlApp(): JSX.Element {
  const [mode, setMode] = useState<Mode>('one')

  return (
    <main data-raw-html-app>
      <button data-same onClick={() => setMode('same')}>
        Equivalent payload
      </button>
      <button data-two onClick={() => setMode('two')}>
        Replace payload
      </button>
      <section data-raw-container dangerouslySetInnerHTML={{ __html: htmlFor(mode) }} />
      <aside data-unaffected>Unaffected</aside>
    </main>
  )
}
