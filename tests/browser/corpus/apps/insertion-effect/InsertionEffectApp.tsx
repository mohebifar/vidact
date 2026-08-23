import { useInsertionEffect, useLayoutEffect, useRef, useState } from 'react'

const trace: string[] = []

export function readInsertionTrace(): readonly string[] {
  return trace
}

export function resetInsertionTrace(): void {
  trace.length = 0
}

function StyledValue({ theme }: { readonly theme: string }): JSX.Element {
  const outputRef = useRef<HTMLOutputElement | null>(null)

  useInsertionEffect(() => {
    trace.push(`insert:${theme}:${outputRef.current === null ? 'null' : 'attached'}`)
    return () => {
      trace.push(`insert-cleanup:${theme}`)
    }
  }, [theme])

  useLayoutEffect(() => {
    trace.push(`layout:${theme}:${outputRef.current?.dataset.theme ?? 'missing'}`)
    return () => {
      trace.push(`layout-cleanup:${theme}`)
    }
  }, [theme])

  return (
    <output ref={outputRef} data-theme={theme}>
      {theme}
    </output>
  )
}

export default function InsertionEffectApp(): JSX.Element {
  const [theme, setTheme] = useState('red')
  const [visible, setVisible] = useState(false)

  return (
    <section>
      {visible && <StyledValue theme={theme} />}
      <button data-toggle-child onClick={() => setVisible((current) => !current)}>
        Toggle child
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
