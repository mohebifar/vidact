import * as React from 'react'
import { useState } from 'react'

type Renderable = { props: Record<string, unknown> }

let authoredRefCalls = 0
let forwardedRefAttaches = 0
let forwardedRefDetaches = 0

export function renderableRefTrace(): readonly [number, number, number] {
  return [authoredRefCalls, forwardedRefAttaches, forwardedRefDetaches]
}

export function resetRenderableRefTrace(): void {
  authoredRefCalls = 0
  forwardedRefAttaches = 0
  forwardedRefDetaches = 0
}

function Slot({
  disabled,
  forwardedRef,
  onBaseClick,
  render,
}: {
  disabled: boolean
  forwardedRef: (node: HTMLAnchorElement | null) => void
  onBaseClick: () => void
  render: Renderable | JSX.Element
}): JSX.Element {
  const renderable = render as Renderable
  const authoredClick = renderable.props.onClick as ((event: MouseEvent) => void) | undefined
  const merged = {
    ...renderable.props,
    className: `base ${String(renderable.props.className ?? '')}`,
    style: { ...(renderable.props.style as object), opacity: disabled ? 0.5 : 1 },
    'data-disabled': disabled,
    children: disabled ? 'Disabled' : renderable.props.children,
    ref: forwardedRef,
    onClick: (event: MouseEvent) => {
      authoredClick?.(event)
      onBaseClick()
    },
  }
  // @ts-expect-error React's element type is replaced by Vidact's compiled JSX type in this corpus.
  return React.cloneElement(render, merged)
}

export function RenderableCapabilityApp(): JSX.Element {
  const [disabled, setDisabled] = useState(false)
  const [href, setHref] = useState('/first')
  const [trace, setTrace] = useState('')

  return (
    <main data-renderable-app>
      <button
        data-toggle-renderable
        onClick={() => {
          setDisabled(true)
          setHref('/second')
        }}
      >
        Toggle
      </button>
      <Slot
        disabled={disabled}
        forwardedRef={(node) => {
          if (node === null) forwardedRefDetaches += 1
          else forwardedRefAttaches += 1
        }}
        onBaseClick={() => setTrace((value) => `${value}base`)}
        render={
          <a
            data-renderable-link
            href={href}
            className="authored"
            style={{ color: 'red' }}
            onClick={(event) => {
              event.preventDefault()
              setTrace((value) => `${value}authored-`)
            }}
            ref={() => {
              authoredRefCalls += 1
            }}
          >
            Open
          </a>
        }
      />
      <output data-renderable-trace>{trace}</output>
    </main>
  )
}
