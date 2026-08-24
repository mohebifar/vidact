# React parity gap audit

Updated: 2026-08-23  
Audited revision: `6b0cc55` (`feat/rust-compiler-rebuild`)  
React reference target: 19.2 web APIs

Dependency-compilation update: 2026-08-24. This is a focused addendum; the
historical baseline counts and unrelated gap classifications below have not
been re-audited.

## Executive decision

Vidact should target **source compatibility for modern React 19.2 web
applications**, not equivalence with React's renderer. A typical function-
component application should compile without architectural rewrites when it
uses the default contract. Uncommon features that require global runtime
machinery should require an explicit compiler feature flag.

The default contract must cover ordinary component syntax, props and children,
state, reducers, refs, effects, context, errors, portals, external stores,
complete lists, and correct browser DOM behavior. SSR and hydration are also a
production requirement, but belong to separate compiler targets and entry
points so client-only applications do not ship server code.

Suspense/resources, interruptible scheduling, Actions, insertion effects,
retained hidden UI, profiling, unsafe raw HTML, and framework protocols are
opt-in. Legacy arbitrary React element inspection, class components, Fiber
semantics, and opaque precompiled React packages remain diagnosed
incompatibilities.

## Audit baseline

The current branch passes the complete repository verification suite:

- 86 Rust compiler tests;
- 72 direct runtime browser tests;
- 19 compiled application browser tests;
- Vite integration, JSX type, and TodoMVC tests.

The current production gzip measurements are:

| Fixture | Gzip | Existing ceiling |
| --- | ---: | ---: |
| Counter | 7,552 B | 7,579 B |
| Control flow | 7,880 B | 7,905 B |
| Keyed list | 8,672 B | 8,708 B |
| TodoMVC | 10,270 B | 10,302 B |

The size gate passes, but the counter still includes forms, raw HTML, styles,
events, namespace handling, and the generic DOM property policy. This proves
that compatibility flags alone are insufficient: the default implementation
also needs **chunk-level capability reachability** so unused core helpers do
not enter a final chunk.

## Compatibility policy

| Level | Product promise | Bundle policy |
| --- | --- | --- |
| **Default core** | Common React application behavior works without configuration. | Emit/import only capabilities actually used by the final chunk. |
| **Required target** | Production capability required before 1.0 but selected as a distinct build target, such as SSR. | Separate client, hydration, and server entry points. |
| **Opt-in feature** | Supported React-shaped behavior that is uncommon or requires cross-cutting machinery. | Disabled by default; source use names the compiler flag needed. Enabling an unused feature adds no browser bytes. |
| **Adapted** | Same application intent with documented observable differences. | No compatibility emulation that undermines direct DOM or adds a general renderer. |
| **Diagnosed** | React behavior conflicts with Vidact's product identity or cannot be made sound. | Source-located compiler error with migration guidance. |
| **Tracked** | Canary or experimental React surface. | No stability promise until React and browser foundations stabilize. |

### Proposed compiler features

These are semantic capability gates, not alternate renderers:

| Feature | Enables | Why opt-in |
| --- | --- | --- |
| `unsafe-html` | `dangerouslySetInnerHTML` and Trusted Types integration | Rare, security-sensitive, and currently pulls raw-HTML machinery into every app. |
| `async` | `lazy`, `use(promise)`, and `<Suspense>` | Requires resource identity, cancellation, staged owners, and boundary state. |
| `concurrent` | `startTransition`, `useTransition`, and `useDeferredValue` | Requires priority queues, stale-work cancellation, and atomic deferred publication. |
| `actions` | `useActionState`, `useOptimistic`, `useFormStatus`, and function form actions | Requires async queues, rollback/rebase, pending form state, and transition integration. |
| `css-insertion` | `useInsertionEffect` | Primarily library-facing and adds a separate commit phase with strict ordering. |
| `retained-ui` | `<Activity>` | Requires disconnect/reconnect semantics for effects while retaining state and DOM. |
| `profiling` | `<Profiler>`, `useDebugValue`, owner stacks, and performance tracks | Development/tooling machinery must erase from production when disabled. |
| `framework` | streaming/static resume, RSC, Server Functions, cache lifetimes, resource/metadata hoisting | Framework protocol work is not ordinary client component behavior. |

`target: client | hydrate | server` is a required build-target choice, not a
nice-to-have feature flag. `hydrate` and `server` may depend on enabled async or
framework capabilities but must not contaminate a client-only bundle.

Every flag and target must participate in compiler/runtime protocol versions,
cache keys, diagnostics, source maps, and production size fixtures. Disabled
syntax must fail at its exact source span and name the smallest enabling flag.

## P0: gaps that can silently misbehave

These block any broad compatibility claim even when the feature family remains
unsupported.

| Gap | Current evidence | Required outcome |
| --- | --- | --- |
| Event-name semantics | Most `onX` names are lowercased. Common React events such as mouse/pointer enter/leave and several animation, transition, media, composition, and selection events are not mapped or rejected. | Implement a complete event policy or reject every unimplemented event at compile time. Never attach a plausible but nonexistent native event. |
| Accepted-syntax coverage | The compatibility manifest contains only 16 fixtures while the compiler accepts a much broader TSX surface. | Manifest every supported, rejected, and intentionally different syntax family, including negative fixtures at the feature span. |
| Whole-component fallback diagnostics | Several prop, spread, list, and control-flow errors still inherit a component span. | All known unsupported forms reject at the narrow original TSX site. |
| Source maps | Compiler and dependency-capsule maps compose back to original application or published package source. | Extend mapped runtime diagnostics and keep every new transform in the composed chain. |
| Reactive escape analysis | The compiler supports a bounded set of derived/control-flow forms and rejects known gaps, but the negative corpus is not exhaustive. | Prove every accepted state/prop read and write enters the updater graph or rejects. |
| Runtime values | A bounded branded renderable capability covers compiler-known element-valued render props without exposing a React element tree. | Complete diagnostics for foreign objects/functions/symbols and keep promises behind `async`; do not widen the capability into a reconciler. |
| Failure recovery | Transactional DOM publication is proven for several cases, but state, retained-row updates, nested cleanup failures, and root recovery do not have a complete boundary model. | Define compute, commit, rollback, error routing, and owner disposal for construction and every update path. |
| Compiler/runtime skew | Protocol strings exist, but build caches and package entry points do not fingerprint all ABI/config inputs. | Refuse incompatible compiler/runtime combinations and invalidate every affected cache. |

## Default-core compiler and language gaps

| Area | Current implementation | Must-have gap |
| --- | --- | --- |
| Component forms | Named function declarations compile; named arrows reject; default/anonymous and several export forms are not lowered. | Support ordinary named declarations, arrows, function expressions assigned to bindings, and default exports by semantic identity. Diagnose genuinely ambiguous factories. |
| Props object | Components require direct object destructuring. | Support `props`, direct/aliased/nested destructuring, defaults, rest, computed reads with provable keys, and stable add/update/delete semantics. |
| Children | Compiled values and component ranges exist, but intrinsic children passed through components can reject because construction is eager in the wrong namespace. | Make `children` a deferred owned value/range with correct namespace, disposal, and repeated-read semantics. |
| Prop spreads | Reactive spreads reject; static spreads use the generic mount path. | Reconcile add/update/delete, events, styles, refs, controlled props, and custom-element properties without stale state. |
| Component-valued props | Phi-derived local component types work; a component type read from a prop slot rejects. | Lower callable component slots and preserve type/key/position identity. |
| Component keys | Dynamic keys are dispatched for covered components. | Complete key semantics for fragments, nested branches, component props, and all supported list forms. |
| Control flow | Early returns, ternaries/logicals, literal terminal switches, structured synchronous regions, and try/catch have bounded support. | Cover common loops, switches with nonliteral cases where sound, nested decisions in list items, thrown errors, and `finally`; otherwise reject precisely. |
| Derived data | Phi-derived values and structured synchronous regions compile. | Cover common aliases, destructuring, computed access, closure capture, and mutation patterns or reject without false acceptance. |
| Lists | Keyed and indexed owners, fragment rows, movement, focus/selection, and disposal exist for bounded map/for-of shapes. | Support nested lists, outer-item dependencies, destructured parameters, common pipelines, keyed fragments, component rows, and property-based failure/identity tests. |
| Keys | Runtime accepts string, number, and bigint; compiler keys are limited to item identity or one static property. | Define the React-shaped public key domain and coercion policy; support stable expressions the compiler can prove, reject the rest. |
| JSX values | Scalars, empties, nodes, arrays, bindings, and owned blocks normalize. | Complete diagnostics for invalid objects/functions/symbols/promises and define the deliberate DOM-node escape hatch. |
| JSX namespace/type surface | HTML, SVG, MathML, custom elements, and a React-shaped type package exist. | Keep type acceptance synchronized with compiler/runtime behavior and add package-level conformance fixtures for every supported intrinsic family. |
| Module boundaries | Vite automatically qualifies reachable React-bearing package entries, builds target-specific capsules, composes published-source maps, and diagnoses opaque constructs. Base UI Button/Input/Toggle Group are certified. | Expand the real-package corpus and make reactive body-local destructuring sound before broad library compatibility claims. TanStack Start remains separate framework work. |
| React imports | Supported APIs and lowered factories are classified through named, aliased, namespace, and bounded default/clone provenance. | Extend classification only with semantic provenance and precise negative fixtures; never infer from minified identifier spelling. |
| Rules of Hooks | `useState` is recognized only in direct component state declarations; `useRef` is an ordinary construct-once helper. | Validate supported hook call sites and make custom hooks compose under one owner without relying on component reruns. |

## Default-core hooks and lifecycle

| React 19.2 surface | Status | Required policy |
| --- | --- | --- |
| `useState` | **Partial** | Finish supported declaration forms, setter lifetime, automatic batching/atomicity outside compiler-wrapped events, remount reset, and thrown-update recovery. |
| `useReducer` | **Missing** | Default core on the state-slot primitive with stable dispatch and initializer semantics. |
| `useRef` | **Partial** | Stable cells work; complete hook classification, custom-hook composition, and component-ref integration. |
| `useImperativeHandle` | **Missing** | Default core, capability-imported only when used; requires component refs and layout commit timing. |
| `createContext` / `useContext` | **Missing** | Default core over logical owners, including branches, lists, portals, and server/hydration values. |
| `use(context)` | **Missing** | Default core on the same owner/context contract; unlike Hooks, preserve React's legal conditional/loop call shape. Promise inputs require `async`. |
| `useEffect` | **Missing** | Default core with cleanup-before-rerun, cleanup-on-disposal, dependency identity, error routing, and post-paint scheduling. |
| `useLayoutEffect` | **Missing** | Default core for DOM/library interoperability with ref-before-layout timing. |
| `useInsertionEffect` | **Missing** | Opt-in `css-insertion`; diagnose by default. |
| `useEffectEvent` | **Missing** | Default core once effects exist; stable nonreactive closure with current-value reads and call-site restrictions. |
| `useMemo` / `useCallback` | **Missing** | Default authoring compatibility. Compile away where safe, but preserve observable identity at prop/effect boundaries. |
| `useId` | **Missing** | Default core with root prefixes and deterministic server/hydration output. |
| `useSyncExternalStore` | **Missing** | Default core for state-library/router interoperability, including atomic snapshots and server snapshots. |
| Custom hooks | **Mostly missing** | Functions composed from supported hooks must share the caller's owner, ordering validation, and cleanup. |
| Error boundaries | **Missing** | Default adapted function API plus root error callbacks. Class boundary syntax remains diagnosed. |
| Automatic batching | **Partial** | Synchronous compiled events batch. Timers, promises, subscriptions, native callbacks, and cross-scope updates need documented atomic behavior. |
| Commit phases | **Missing** | Define mutation, ref/imperative-handle, layout, passive effect, and error/cleanup phases. `css-insertion` adds its opt-in phase. |

## Opt-in hooks and async APIs

| React 19.2 surface | Feature | Gap |
| --- | --- | --- |
| `lazy`, `use(promise)`, `<Suspense>` | `async` | Resource cache/identity, pending/fulfilled/rejected ownership, stale resolution, cancellation, nested boundaries, hydration, and error propagation are missing. |
| `startTransition`, `useTransition` | `concurrent` | No priority scheduler, interruptible work, stale-work cancellation, or atomic deferred commit exists. |
| `useDeferredValue` | `concurrent` | Depends on the same scheduler and stale-publication contract. |
| `useOptimistic` | `actions` | Optimistic queues, rollback, and rebase are missing. |
| `useActionState` | `actions` | Sequential async action queues, pending state, errors, and transition integration are missing. |
| `useFormStatus` | `actions` | Form owner/status propagation and progressive enhancement are missing. |
| Function `action` / `formAction` | `actions` | Current types reject them; action dispatch, reset, errors, and server/client behavior are missing. |
| `<Activity>` | `retained-ui` | Hidden/restored DOM and state plus disconnected/reconnected effects are missing. |

`flushSync` belongs to `concurrent` only after asynchronous work exists. In the
default synchronous core, exporting a no-op compatibility wrapper would hide a
semantic difference and is therefore diagnosed.

## Built-in components and APIs

| Surface | Policy | Gap or deliberate behavior |
| --- | --- | --- |
| `<Fragment>` | Default core | Owned multi-node component ranges exist; complete keyed fragments, nested-list forms, and hydration. The ref surface is tracked separately while Canary. |
| `createPortal` | Default core, usage-reachable | Missing logical ownership/context/errors and cross-container disposal. Vidact may document native physical DOM bubbling instead of React-tree synthetic bubbling. |
| `memo` | Default adapted | Treat as a compiler hint/prop invalidation boundary while preserving comparator and identity expectations that affect behavior. |
| `act` | Default test package | Missing deterministic draining of state, refs, layout/passive effects, async resources, and scheduler queues. Must add no production bytes. |
| `<StrictMode>` | Adapted development API | Provide removable development checks; exact React double-invocation is outside the product identity. |
| `<Profiler>` | `profiling` | Instrument updater/range/effect/scheduler work rather than React render duration. |
| `useDebugValue`, `captureOwnerStack` | `profiling` | Require owner-aware development tooling and production erasure. |
| Resource preload APIs | Usage-reachable or `framework` | `preconnect`, `prefetchDNS`, `preload`, `preloadModule`, `preinit`, and `preinitModule` are missing. Prefer compiler/framework emission when globally coordinated. |
| `cache`, `cacheSignal` | `framework` | Require server/resource lifetimes; absent. |
| React Compiler directives | Adapted compiler API | `"use memo"` / `"use no memo"` need documented Vidact meanings or precise guidance. |
| `<ViewTransition>` | Tracked | React marks it Canary. Do not promise until the API and browser foundation stabilize. |
| Fragment refs | Tracked | Keep the Canary `FragmentInstance` surface outside the stable contract until React promotes it. |
| `browser()` | Tracked | React marks this server-rendering resource API Canary; do not stabilize it through the default or `framework` contracts yet. |

## DOM compatibility gaps

| Area | Proven now | Remaining must-have work |
| --- | --- | --- |
| Namespaces | HTML, SVG, MathML, `foreignObject` islands, and namespaced attributes | Full intrinsic/attribute corpus, integration across deferred children/portals/hydration, and feature reachability. |
| Properties/attributes | Common booleans, booleanish/overloaded values, ARIA/data strings, deletion, custom elements | Complete React 19 property tables, URL/security-sensitive values, enumerated attributes, custom-element React 19 edge cases, and generated conformance tests. |
| Styles | Object styles, deletion, custom properties, numeric units | Complete unitless/vendor-prefixed property data, warning/error policy, CSS Typed OM decision, cross-browser conformance, and omission from chunks that do not use style. |
| Events | Replacement, removal, capture, double-click, focus/blur mapping, native event objects | Complete name mapping, enter/leave semantics, non-bubbling events, composition/before-input, selection, media, animation/transition, pointer/touch, shadow DOM, passive/options policy, and exception routing. |
| Synthetic events | Intentionally absent | Publish native event types and migration guidance. Any React-only event field must fail type checking rather than be undefined at runtime. |
| Controlled forms | Text, textarea, checkbox, radio, select, multiple select, event restoration in Chromium | Controlled/uncontrolled transitions, default updates, number/date/file inputs, IME/composition, selection, form reset, autofill, radio groups, submit behavior, and Firefox/WebKit parity. |
| Refs | Host object/callback refs, callback cleanup, conditional disposal | Reactive ref identity, component ref-as-prop, imperative handles, keyed moves, ref errors, and portal/hydration timing. Fragment refs remain tracked while Canary. |
| Raw HTML | Opaque owned subtree, validation, Trusted Types preservation, transactional replacement | Move behind `unsafe-html`; omit all raw-HTML code otherwise. Complete CSP/Trusted Types/injection/browser gates. |
| Metadata/resources | Created where written | React 19 head hoisting, deduplication, resource suspension, precedence, and server integration belong to `framework`; default behavior must be documented. |
| Custom elements | Direct construction and property/attribute fallback | Complete event naming, property upgrade timing, boolean/object values, `is`, SSR/hydration, and React 19 conformance. |

## Roots, SSR, hydration, and frameworks

| Surface | Level | Gap |
| --- | --- | --- |
| Client root | Default core | `mountCompiled` is the only root API. Add stable create/mount/unmount, root options, error callbacks, protocol checks, and HMR ownership. Repeated `root.render(ReactElement)` is intentionally not promised. |
| `createRoot` compatibility | Adapted | Provide an application-factory/root-input shape instead of accepting arbitrary element descriptors. |
| Deterministic SSR | Required `server` target | No server emitter, escaping contract, deterministic IDs, owner serialization, or browser-global separation exists. |
| `hydrateRoot` | Required `hydrate` target | No marker protocol, node claiming, keyed-range reconstruction, mismatch boundaries, event setup, or compiler/runtime skew recovery exists. |
| `renderToString` / `renderToStaticMarkup` | Required convenience after server IR | Missing; both should wrap the canonical deterministic emitter. |
| `renderToReadableStream` / `renderToPipeableStream` | `framework` | Web-stream and Node-stream rendering, abort/error handling, boundary flushing, and backpressure are missing. |
| `resume` / `resumeToPipeableStream` | `framework` | Continuation payloads, integrity/versioning, and resumed boundary ownership are missing. |
| `prerender` / `prerenderToNodeStream` | `framework` | Static waiting, prelude/continuation output, cancellation, and resource coordination are missing. |
| `resumeAndPrerender` variants | Tracked | React marks these static continuation APIs experimental; inventory them without a stability promise. |
| Server Components / Server Functions | `framework` | `use client` / `use server`, manifests, serialization, module references, actions, routing/data integration, and security boundaries are missing. |
| Resource/metadata hoisting | `framework` | Head ownership, deduplication, precedence, preload coordination, and streaming interaction are missing. |

## Ecosystem and production gaps

| Area | Current state | Must-have outcome |
| --- | --- | --- |
| Third-party libraries | Reachable React-bearing JavaScript/TSX entries compile automatically through deterministic capsules; `includeDependencies` and `exclude` are explicit overrides. Base UI is the first published proof. | Add package/version fixtures and reactive body-local support; keep opaque renderer-dependent packages diagnosed. |
| Router/state interop | Context, effects, portals, external-store hooks, and errors are absent. | Complete the default hooks needed by mainstream routers and stores before claiming application parity. |
| Testing | Runtime and app browser corpora are strong but Chromium-only; no `act`/testing-library adapter. | Add Firefox/WebKit, deterministic lifecycle draining, user-event/form coverage, and an integration path for DOM testing tools. |
| HMR | Root replacement disposes prior owners, while dependency capsules watch and invalidate only contributing modules/manifests. | Define any future state-preservation boundary without weakening disposal or cache correctness. |
| Compiler distribution | Every uncached transform spawns `cargo run`; no production binary/native binding/daemon. | Ship a versioned compiler artifact or persistent service with deterministic startup and incremental caching. |
| Cache correctness | Compiler keys include protocols, target, features, source, filename, and environment; capsule fingerprints also include mapped code, manifests, defines, and contributors. | Add persistent-cache and cross-process invalidation coverage if compilation moves out of process. |
| Bundler integrations | Vite exists; no stable generic Node or Babel adapter. | Publish one compiler core API and at least one production-grade integration. Other adapters must not fork semantics. |
| Packages | Packages are private and export TypeScript source. | Publish built ESM/types/source maps with conditions, side-effects declarations, clean-install tests, provenance, and semver policy. |
| Diagnostics | Stable codes and CLI locations exist. | Publish a complete catalog, original TSX maps, migration suggestions, and production/dev error lookup. |
| Browser/Node policy | Node is pinned for development; browser corpus is Chromium-only. | Publish supported versions and enforce them in CI. |
| Performance | Gzip budgets exist; compiler/update/memory benchmarks do not. | Gate cold/incremental compilation, mount/update throughput, allocations, retained owners, and representative total app size. |
| Security | Raw HTML has bounded protections. | Add CSP, Trusted Types, URL/injection, server escaping, hydration payload, and Server Function threat-model gates as applicable. |
| Release process | No public migration/release/provenance contract. | Define diagnostics stability, compatibility manifest versioning, changelog/migration policy, provenance, and 1.0 stop conditions. |

## Accepted semantic differences

These differences preserve Vidact's product identity and should be documented,
typed, and covered as `different` compatibility fixtures:

- Components construct once per mount; updates run static fine-grained
  updaters instead of rerendering and diffing.
- There is no public React element object, Virtual DOM, Fiber renderer, or
  arbitrary `root.render(element)` interpreter.
- Browser handlers receive native DOM events, not React SyntheticEvents.
- Error boundaries use a function/owner API; class component boundaries remain
  unsupported.
- `memo` is a compiler/invalidation hint because whole-component rerenders are
  not the default unit of work.
- Development checks do not reproduce Strict Mode's exact double invocation.
- Portal events may follow physical DOM propagation rather than React's logical
  synthetic-event bubbling, provided this is explicit and context/error
  ownership remains logical.
- The default client scheduler is synchronous. Interruptible/deferred semantics
  require `concurrent`; they are never approximated with a timeout.
- Third-party components must compile through Vidact's supported lowered/source
  subset or use an explicit adapter; embedding React as a fallback is excluded.

## Explicitly diagnosed React surfaces

Do not add these to the browser runtime merely for API-count parity:

- class `Component` and `PureComponent`;
- `Children`, `cloneElement`, and `isValidElement` over arbitrary element
  objects (bounded compiler-known renderable patterns are adapted);
- general `createElement` values outside statically lowerable calls;
- opaque precompiled React component libraries or renderer integrations whose
  import provenance or behavior falls outside dependency capsules;
- Fiber/concurrent renderer internals and React DevTools protocol equivalence;
- removed React DOM APIs such as legacy `render`, `hydrate`, and
  `findDOMNode`.

`forwardRef` is now a bounded compile-time migration shim and does not establish
a legacy element or class runtime. `createRef` remains low priority. Prefer
`useRef` and React 19 ref-as-prop.

## Delivery order

1. **Close silent-misbehavior paths.** Complete event/DOM rejection tables,
   feature-span diagnostics, negative corpus coverage, original TSX maps, and
   compiler/runtime/cache fingerprints.
2. **Finish default component authoring.** Component forms, prop store,
   deferred children, spreads, callable component slots, nested lists, custom
   hooks, and state semantics.
3. **Add default lifecycle and interoperability.** Reducers, context, effects,
   commit phases, errors, external stores, IDs, refs, portals, testing APIs,
   and broader third-party dependency coverage.
4. **Finish browser and package production gates.** Complete DOM/events/forms,
   capability reachability, Firefox/WebKit, HMR, compiler distribution,
   published packages, performance, memory, and security.
5. **Build deterministic server and hydration targets.** Shared IR, escaping,
   IDs, markers, claiming, mismatches, and root APIs.
6. **Add opt-in families in dependency order.** `unsafe-html`, `css-insertion`,
   `async`, `concurrent`, `actions`, `retained-ui`, `profiling`, then
   `framework`.

## Completion gates for a parity claim

- Every official React 19.2 surface is classified as default, required target,
  opt-in, adapted, diagnosed, or tracked.
- Every accepted syntax/API has compiler fixtures and Chromium, Firefox, and
  WebKit behavior where browser-observable.
- Every rejected or flag-gated API fails at its original source span with
  migration/enabling guidance.
- Default applications do not include runtime modules for unused DOM or React
  capabilities; each opt-in family has an incremental gzip budget.
- Representative applications using routers, external stores, forms, portals,
  effects, errors, SSR, and hydration pass without React in production output.
- Packages install from built artifacts and preserve types, source maps,
  protocol compatibility, CSP/Trusted Types, and release provenance.

## Primary evidence

Local implementation and contracts:

- `README.md`
- `docs/plans/2026-08-20-1543-feat-vidact-production-rebuild-plan.md`
- `docs/roadmap/current-support-gap-audit.md`
- `docs/roadmap/react-feature-roadmap.md`
- `docs/architecture/compact-compiler-runtime-abi.md`
- `docs/architecture/lowered-react-dependency-capsules.md`
- `crates/vidact-compiler/src/react_bindings.rs`
- `crates/vidact-compiler/src/oxc_react/classifier.rs`
- `crates/vidact-compiler/src/surgical_codegen/`
- `crates/vidact-compiler/tests/`
- `packages/runtime/src/`
- `packages/runtime/test/`
- `packages/vite-plugin/src/`
- `packages/react-types/`
- `tests/browser/corpus/`
- `tests/runtime-size/`

React 19.2 reference surface:

- <https://react.dev/reference/react>
- <https://react.dev/reference/react/hooks>
- <https://react.dev/reference/react/components>
- <https://react.dev/reference/react/apis>
- <https://react.dev/reference/react-dom>
- <https://react.dev/reference/react-dom/hooks>
- <https://react.dev/reference/react-dom/components>
- <https://react.dev/reference/react-dom/client>
- <https://react.dev/reference/react-dom/server>
- <https://react.dev/reference/react-dom/static>
- <https://react.dev/reference/react/legacy>
