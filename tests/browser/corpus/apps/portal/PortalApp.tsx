import { createContext, useContext, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const Theme = createContext('default')
const layoutTrace: string[] = []
let portalTarget: HTMLElement | undefined

export function configurePortalTarget(target: HTMLElement): void {
  portalTarget = target
}

export function readPortalLayoutTrace(): readonly string[] {
  return layoutTrace
}

export function resetPortalState(): void {
  layoutTrace.length = 0
  portalTarget = undefined
}

function PortalChild(): JSX.Element {
  const theme = useContext(Theme)
  const id = useId()
  const [count, setCount] = useState(0)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useLayoutEffect(() => {
    layoutTrace.push(buttonRef.current?.dataset.portal ?? 'missing')
  }, [])

  return (
    <article data-portal-child data-theme={theme} id={id}>
      <output data-portal-theme={theme}>{theme}</output>
      <output data-portal-count={count}>{count}</output>
      <button ref={buttonRef} data-portal="ready" onClick={() => setCount(count + 1)}>
        Increment portal
      </button>
    </article>
  )
}

function PortalContent(): JSX.Element {
  if (portalTarget === undefined) throw new Error('portal target is not configured')
  return createPortal(<PortalChild />, portalTarget)
}

export default function PortalApp(): JSX.Element {
  const [theme, setTheme] = useState('red')
  const [visible, setVisible] = useState(true)

  return (
    <section data-logical-root>
      <Theme value={theme}>{visible && <PortalContent />}</Theme>
      <button
        data-toggle-theme
        onClick={() => setTheme((value) => (value === 'red' ? 'blue' : 'red'))}
      >
        Toggle theme
      </button>
      <button data-toggle-portal onClick={() => setVisible((current) => !current)}>
        Toggle portal
      </button>
    </section>
  )
}
