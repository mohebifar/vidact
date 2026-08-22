import type { VidactNode } from '@vidact/react-types'
import type { ReactElement } from 'react'

const child: VidactNode = 'child'

const nativeElements: JSX.Element = (
  <main aria-label="Type contract" className="contract">
    <button
      disabled
      onClick={(event) => {
        event.currentTarget.disabled = true
        // @ts-expect-error Vidact dispatches native DOM events, not React SyntheticEvents.
        void event.nativeEvent
      }}
      type="button"
    >
      {child}
    </button>
    <label htmlFor="contract-input">Value</label>
    <input id="contract-input" autoComplete="off" />
  </main>
)

const customElement = <vidact-card data-tone="positive">Custom child</vidact-card>
const captureHandler = (
  <div
    onClickCapture={(event) => {
      event.currentTarget.dataset.captured = 'true'
    }}
  />
)

void nativeElements
void customElement
void captureHandler

// @ts-expect-error `href` is not a button attribute.
const invalidAttribute = <button href="/not-a-button-link" />

// @ts-expect-error The direct DOM runtime deliberately rejects raw HTML injection.
const unsupportedAttribute = <div dangerouslySetInnerHTML={{ __html: '<b>unsafe</b>' }} />

// @ts-expect-error React server actions are not native DOM form actions.
const unsupportedFormAction = <form action={() => undefined} />

// @ts-expect-error Vidact does not hydrate server-rendered markup.
const unsupportedHydrationFlag = <div suppressHydrationWarning />

// @ts-expect-error SVG needs namespace-aware compiler lowering before it is supported.
const unsupportedSvg = <svg viewBox="0 0 10 10" />

// @ts-expect-error Vidact JSX produces an owned compiled range, not a React element descriptor.
const reactElement: ReactElement = <div />

void invalidAttribute
void unsupportedAttribute
void unsupportedFormAction
void unsupportedHydrationFlag
void unsupportedSvg
void reactElement
