import { Activity, useState } from 'react'

export function RetainedActivity() {
  const [mode, setMode] = useState<'visible' | 'hidden'>('visible')
  return (
    <main>
      <button onClick={() => setMode('hidden')}>hide</button>
      <Activity mode={mode}>
        <section>retained</section>
      </Activity>
    </main>
  )
}
