import { Activity, useState } from 'react'

export function RetainedFixture(): JSX.Element {
  const [mode, setMode] = useState<'visible' | 'hidden'>('visible')
  return (
    <main>
      <button onClick={() => setMode((current) => (current === 'visible' ? 'hidden' : 'visible'))}>
        toggle
      </button>
      <Activity mode={mode}>
        <section>retained</section>
      </Activity>
    </main>
  )
}
