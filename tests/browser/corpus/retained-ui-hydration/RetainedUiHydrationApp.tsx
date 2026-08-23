import { Activity, useState } from 'react'

export function RetainedUiHydrationApp(): JSX.Element {
  const [mode, setMode] = useState<'visible' | 'hidden'>('hidden')
  return (
    <main>
      <button data-show onClick={() => setMode('visible')}>
        show
      </button>
      <Activity mode={mode}>
        <section
          data-hydrated-panel
          data-vidact-activity-display="authored-display"
          data-vidact-activity-priority="authored-priority"
          style={{ color: 'red', display: 'grid' }}
        >
          <output data-count>3</output>
        </section>
      </Activity>
    </main>
  )
}
