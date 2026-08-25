# React compatibility matrix

Vidact compiles a React-shaped TSX subset to direct DOM construction and
static, fine-grained updates. It is **not** a React renderer: it has no React
element tree, Virtual DOM, Fiber, or React runtime fallback. This matrix is the
current source-compatibility contract for React 19.2 web APIs.

## Reading the matrix

| Vidact status | Meaning |
| --- | --- |
| **Supported** | Works in compiled source, subject to the documented source subset. |
| **Opt-in** | Supported when the named compiler feature is enabled. |
| **Targeted** | Supported only by the named `client`, `hydrate`, or `server` build target. |
| **Adapted** | Supported for the same application intent with deliberate observable differences. |
| **Diagnosed** | Rejected at compile time; there is no React runtime fallback. |
| **Tracked** | React Canary/experimental surface; no Vidact stability promise. |

All supported application components must be compiled by Vidact. The compiler
accepts ordinary function and arrow component forms, supported custom hooks,
and source-published dependencies it can qualify. Unsupported syntax or
feature-gated API use is diagnosed rather than silently leaving a React call in
the output.

## Rendering model and component authoring

| Feature | React 19.2 | Vidact | Notes |
| --- | --- | --- | --- |
| Function components | Built-in | **Supported** | Components construct once per mount. State updates run selected DOM, range, effect, and prop updaters; the component does not rerender to diff a tree. |
| Function declarations, arrows, expressions, default exports | Built-in | **Supported** | Supported forms are identified by semantic bindings, including named/default and anonymous default functions. |
| Class components / `Component` / `PureComponent` | Built-in legacy API | **Diagnosed** | Use function components. Class error boundaries are not supported. |
| JSX, fragments, nested components, and renderable children | Built-in | **Supported** | Vidact owns DOM ranges for fragments, conditionals, nested components, and arrays. |
| Automatic and classic JSX factories | Built-in | **Supported** | The compiler recognizes supported React factory provenance and lowers it to Vidact output. |
| `createElement` | Built-in | **Adapted** | Supported only for statically lowerable calls; arbitrary React element descriptors are not a runtime value model. |
| `createPortal` | Built-in | **Adapted** | Client portals preserve Vidact ownership, context, and disposal. Events bubble through the physical DOM as native events, not through a React synthetic-event tree. Server portals are rejected. |
| `forwardRef` | Built-in legacy helper | **Adapted** | Bounded compile-time migration shim for an inline function with simple props/ref parameters. Prefer React 19 ref-as-prop. |
| `memo` | Built-in | **Adapted** | A compiler/invalidation hint, not a whole-component rerender wrapper. Custom comparators are unsupported. |
| `lazy` | Built-in | **Opt-in** `async` | Use with `<Suspense>`. |
| `Suspense` | Built-in | **Opt-in** `async` | Promise/resource ownership, fallback ranges, server markers, and hydration are compiled together. |
| `Activity` | Built-in | **Opt-in** `retained-ui` | Hidden content retains state and DOM while lifecycle work is disconnected/reconnected. |
| `StrictMode` | Built-in | **Adapted** | Vidact development checks do not emulate React Strict Mode's double invocation. |
| `Profiler` | Built-in | **Opt-in** `profiling` | Reports Vidact updater/range/effect work rather than React render duration. |
| `Fragment` refs / `FragmentInstance` | Canary | **Tracked** | No stable compatibility commitment. |
| `<ViewTransition>` / transition-type APIs | Canary | **Tracked** | No stable compatibility commitment. |

## State, context, and every hook

| React API | React 19.2 | Vidact | Notes |
| --- | --- | --- | --- |
| `useState` | Built-in | **Supported** | Initializers, direct values, functional updates, batching, and fine-grained invalidation are compiler-lowered. State remains local to the compiled owner. |
| `useReducer` | Built-in | **Supported** | Compiler-lowered state slot with stable dispatch and initializer support. |
| `useRef` | Built-in | **Supported** | Stable mutable ref cells and host object/callback refs are supported. React 19 ref-as-prop is supported. |
| `useImperativeHandle` | Built-in | **Supported** | Runs in Vidact's ref/layout commit phase. Keep the exposed handle within the supported compiled dependency forms. |
| `createContext` | Built-in | **Supported** | Provider values follow Vidact logical ownership across branches, lists, portals, server rendering, and hydration. |
| `useContext` | Built-in | **Supported** | Reads a `createContext` context during compiled component construction. |
| `use(context)` | Built-in | **Supported** for context | Context inputs can be used where React permits `use`. Promise inputs require `async`. |
| `use(promise)` | Built-in | **Opt-in** `async` | Suspends through Vidact resources and `<Suspense>` boundaries. |
| `useEffect` | Built-in | **Supported** | Cleanup runs before a dependency change and on owner disposal; passive effects run after commit. |
| `useLayoutEffect` | Built-in | **Supported** | Runs after DOM/ref commit and before passive effects. |
| `useInsertionEffect` | Built-in | **Opt-in** `css-insertion` | Separate insertion phase intended for CSS-in-JS/library work. |
| `useEffectEvent` | Built-in | **Supported** | Creates a stable nonreactive callback that observes current compiled values. |
| `useMemo` | Built-in | **Supported** | Compiler preserves observable identity at prop/effect boundaries and may lower safe calculations into static derivations. |
| `useCallback` | Built-in | **Supported** | Compiler preserves callback identity where it is observable; it is not a rerender optimization. |
| `useId` | Built-in | **Supported** | IDs use root prefixes and are deterministic across matching server/hydration builds. |
| `useSyncExternalStore` | Built-in | **Supported** | Compiles subscriptions and snapshot reads; server rendering uses the server snapshot when supplied. |
| `useTransition` | Built-in | **Opt-in** `concurrent` | Uses Vidact's interruptible scheduler and pending state. |
| `startTransition` | Built-in | **Opt-in** `concurrent` | Never emulated with timers in the synchronous core. |
| `useDeferredValue` | Built-in | **Opt-in** `concurrent` | Uses the same deferred scheduling and stale-work cancellation model. |
| `flushSync` | `react-dom` API | **Opt-in** `concurrent` | Forces the appropriate Vidact scheduler flush. |
| `useActionState` | Built-in | **Opt-in** `actions` | Compiler-lowered sequential action state and pending state. |
| `useOptimistic` | Built-in | **Opt-in** `actions` | Compiler-lowered optimistic layer with rebase/settlement behavior. |
| `useFormStatus` | `react-dom` hook | **Opt-in** `actions` | Reads the nearest compiled function-form action status. |
| `useDebugValue` | Built-in | **Opt-in** `profiling` | Development/profiling data; omitted when profiling is disabled. |
| `captureOwnerStack` | Built-in | **Opt-in** `profiling` | Returns Vidact owner-stack information, not React Fiber stacks. |
| Custom hooks | Built-in pattern | **Supported** | Custom hooks composed from supported APIs share the caller's compiled owner; unsupported hook calls remain diagnosed. |

## DOM, events, lists, refs, and forms

| Feature | React 19.2 | Vidact | Notes |
| --- | --- | --- | --- |
| Direct DOM updates | Reconciliation renderer | **Adapted** | No Virtual DOM diffing or runtime dependency discovery. Static read/write masks select affected updates. |
| Conditional rendering | Built-in | **Supported** | Ternary, logical, nullish, terminal-switch, and supported synchronous control-flow forms own disposable DOM ranges. |
| Arrays and keyed lists | Built-in | **Supported** | Keyed and indexed list ranges preserve/move/dispose their owned DOM records. Duplicate keys fail before mutation. |
| Keys | Built-in | **Supported** | Use stable primitive keys in compiler-supported list shapes; unsupported/ambiguous list expressions are diagnosed. |
| HTML, SVG, MathML, custom elements | Built-in DOM support | **Supported** | Includes namespace transitions and SVG `foreignObject` HTML islands. |
| Attributes, properties, styles, and spreads | Built-in | **Supported** | Reactive spreads reconcile additions, changes, and removals, including relevant form/ref/listener behavior. |
| `dangerouslySetInnerHTML` | Built-in | **Opt-in** `unsafe-html` | Explicit unsanitized sink; supports strings/TrustedHTML. It cannot be combined with children, is disallowed on void elements/textarea/SVG/MathML, and executable script insertion is rejected. |
| Browser events | Synthetic events | **Adapted** | Handlers receive native DOM events. Capture handlers and supported React event names are mapped; unknown event props are diagnosed. |
| Event bubbling through portals | React-tree synthetic bubbling | **Adapted** | Native physical-DOM bubbling applies. |
| Controlled and uncontrolled forms | Built-in | **Supported** | Covers text inputs, textareas, checkboxes, radios, selects, multiple selects, and React-shaped `onChange` timing with native events. |
| Function `action` / `formAction` | Built-in | **Opt-in** `actions` | Supports function-valued form actions and `useFormStatus`; ordinary URL actions remain normal DOM behavior. |
| Host refs | Built-in | **Supported** | Object/callback refs, cleanup, conditionals, list ownership, and compiled root disposal are supported. |
| Component refs | React 19 ref-as-prop | **Supported** | Prefer ref-as-prop; use `useImperativeHandle` for explicit handles. |
| Error boundaries | Class API | **Adapted** | Use Vidact's function/owner error boundary plus root `onCaughtError`, `onUncaughtError`, and hydration `onRecoverableError` callbacks. |

## Roots, SSR, hydration, and framework APIs

| Surface | React 19.2 | Vidact | Notes |
| --- | --- | --- | --- |
| Client roots | `createRoot(...).render(element)` | **Adapted** | `mountCompiled` / `createRoot` mount a compiled application factory. Repeated `root.render(ReactElement)` is intentionally not supported. |
| HMR | Tooling integration | **Supported** | `mountHotRoot` disposes the previous compiled owner. Module-local state resets; external stores are the state-preservation boundary. |
| SSR | `renderToString`, `renderToStaticMarkup` | **Targeted** `server` | Deterministic server renderer escapes text/attributes and has no browser globals. |
| Hydration | `hydrateRoot` | **Targeted** `hydrate` | Claims Vidact server markup and reports recoverable mismatches. Server and hydration output must use the same runtime protocol version. |
| Streaming SSR | `renderToReadableStream`, `renderToPipeableStream` | **Opt-in** `framework` + `server` | Provides Vidact Web/Node stream APIs, abort handling, continuations, and client-boundary protocol—not React Flight. |
| Static rendering | `prerender`, `prerenderToNodeStream` | **Opt-in** `framework` + `server` | Provides Vidact prelude/postponed continuation output. |
| Resume APIs | `resume`, `resumeToPipeableStream` | **Opt-in** `framework` + `server` | Vidact continuation protocol; React's implementation details are not shared. |
| Server Components / Server Functions | Framework APIs | **Opt-in** `framework` | Uses explicit manifests, closed serializable values, client boundaries, and application-owned server-function registry. It does not consume React Flight payloads. |
| `cache` / `cacheSignal` | Built-in server API | **Opt-in** `framework` + `server` | Request-scoped server cache lifetime. `cache` is diagnosed in client-target code. |
| Resource hint APIs | `preconnect`, `prefetchDNS`, `preload`, `preloadModule`, `preinit`, `preinitModule` | **Opt-in** `framework` | Emits/deduplicates document resource hints and participates in server/framework rendering. |
| Metadata / document head hoisting | Built-in framework behavior | **Opt-in** `framework` | Vidact hoists supported metadata/resources through its own framework protocol. |

## Element utilities, test utilities, and intentional exclusions

| API or surface | React 19.2 | Vidact | Notes |
| --- | --- | --- | --- |
| `cloneElement` | Built-in | **Adapted** | Only compiler-known Vidact renderable capabilities can be cloned; arbitrary React element objects are not accepted. |
| `isValidElement` | Built-in | **Adapted** | Tests Vidact's bounded renderable capability, not a React element object. |
| `Children.toArray` | Built-in | **Adapted** | Accepts one compiled renderable capability; general opaque child traversal is unavailable. |
| Other `Children` utilities | Built-in | **Diagnosed** | No general React child descriptor traversal. |
| `createRef` | Built-in legacy helper | **Diagnosed** | Use `useRef` or ref-as-prop. |
| Legacy DOM roots / `findDOMNode` | Legacy APIs | **Diagnosed** | Use compiled root factories and refs. |
| React DevTools / Fiber internals | Tooling internals | **Diagnosed** | Vidact does not emulate Fiber or its protocol. |
| `act` | Test utility | **Supported** | `@vidact/test-support` provides deterministic scheduler draining for compiled tests. |
| React renderer-dependent packages | Ecosystem | **Diagnosed** unless compiled | Source-published React-shaped dependencies can be qualified through the Vite integration; opaque precompiled React packages need an adapter. |
| React experimental/static continuation variants | Experimental | **Tracked** | No stability promise until the React and browser APIs stabilize. |

## Feature selection

Pass only the needed feature names to `@vidact/compiler` or `@vidact/vite`:

| Compiler feature | Enables |
| --- | --- |
| `unsafe-html` | `dangerouslySetInnerHTML` |
| `css-insertion` | `useInsertionEffect` |
| `async` | `lazy`, `use(promise)`, `<Suspense>` |
| `concurrent` | transitions, deferred values, `flushSync` |
| `actions` | action hooks and function form actions |
| `retained-ui` | `<Activity>` |
| `profiling` | `<Profiler>`, `useDebugValue`, `captureOwnerStack` |
| `framework` | streaming/static/resume APIs, server components/functions, cache, metadata, resource hints |

Feature flags are capability gates, not a React-runtime compatibility mode.
Disabled use fails at the source span that needs the feature, and unused
capability modules are omitted from client bundles.

For setup and migration mechanics, see [Migrating a React application to
Vidact](../migration/from-react.md). For the test-backed source boundary, see
the `vidact-react-subset-v1` compatibility fixtures under
`crates/vidact-compiler/tests/fixtures/compatibility/`.
