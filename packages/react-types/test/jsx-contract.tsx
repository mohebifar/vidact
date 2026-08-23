import type { VidactNode } from '@vidact/react-types'
import { Suspense, createContext, lazy, use, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

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
const rawHtml = <div dangerouslySetInnerHTML={{ __html: '<b>trusted source</b>' }} />
const namespacedElements = (
  <svg viewBox="0 0 10 10">
    <circle
      cx="5"
      cy="5"
      r="4"
      onClick={(event) => event.currentTarget.setAttribute('data-clicked', 'yes')}
    />
    <foreignObject>
      <div>HTML island</div>
    </foreignObject>
  </svg>
)
const mathElement = (
  <math>
    <mi>x</mi>
  </math>
)
const Theme = createContext('light')
const contextProvider = (
  <Theme value="dark">
    <strong>Owned context child</strong>
  </Theme>
)
const legacyContextProvider = (
  <Theme.Provider value="dark">
    <strong>Owned provider child</strong>
  </Theme.Provider>
)
const portal = createPortal(<strong>Portal child</strong>, document.body)
const LazyMessage = lazy(async () => ({ default: () => <strong>lazy</strong> }))
const asyncBoundary = (
  <Suspense fallback={<p>loading</p>}>
    <LazyMessage />
  </Suspense>
)
const usedPromise: string = use(Promise.resolve('ready'))

void nativeElements
void customElement
void captureHandler
void rawHtml
void namespacedElements
void mathElement
void contextProvider
void legacyContextProvider
void portal
void asyncBoundary
void usedPromise

// @ts-expect-error `href` is not a button attribute.
const invalidAttribute = <button href="/not-a-button-link" />

// @ts-expect-error Raw HTML must use React's `{ __html: string | TrustedHTML }` shape.
const invalidRawHtml = <div dangerouslySetInnerHTML={{ html: '<b>invalid</b>' }} />

// @ts-expect-error React server actions are not native DOM form actions.
const unsupportedFormAction = <form action={() => undefined} />

// @ts-expect-error Vidact does not hydrate server-rendered markup.
const unsupportedHydrationFlag = <div suppressHydrationWarning />

// @ts-expect-error Vidact JSX produces an owned compiled range, not a React element descriptor.
const reactElement: ReactElement = <div />

// @ts-expect-error Plain objects are not renderable Vidact children.
const objectChild = <div>{{ type: 'foreign-element' }}</div>

// @ts-expect-error Functions are not renderable Vidact children.
const functionChild = <div>{() => 'invalid'}</div>

// @ts-expect-error Symbols are not renderable Vidact children.
const symbolChild = <div>{Symbol('invalid')}</div>

// @ts-expect-error Promises require the unavailable `async` feature.
const promiseChild = <div>{Promise.resolve('invalid')}</div>

void invalidAttribute
void invalidRawHtml
void unsupportedFormAction
void unsupportedHydrationFlag
void reactElement
void objectChild
void functionChild
void symbolChild
void promiseChild
