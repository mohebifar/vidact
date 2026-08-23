# Migrating a React application to Vidact

Vidact accepts a modern React-shaped function-component subset and compiles it
to owned DOM ranges and static updater slots. It does not embed React or provide
a general React element interpreter, so migrate at source boundaries rather
than treating Vidact as another React renderer.

## Start with the Vite compiler

Use `@vidact/vite` and keep application TSX in the compiler's include set.
Compatible source-published dependencies can be opted in with
`includeDependencies`; precompiled renderer-dependent packages should remain
excluded and will fail before browser execution when their React values cross a
compiled boundary.

Choose one target per build:

- `client` constructs a fresh browser root;
- `hydrate` claims matching output from the Vidact server target;
- `server` emits deterministic HTML without browser globals.

Do not mix generated output from different compiler/runtime protocol versions.

## Move roots to application factories

Vidact roots mount a compiled application factory. They intentionally do not
accept arbitrary React element descriptors or repeated `root.render(element)`
calls. Put changing data in compiled state, props, context, or an external store
and dispose the returned root when its host is removed.

## Keep modern function components

Use function components and supported custom hooks. Class components,
`Children`, `cloneElement`, arbitrary `createElement` values, legacy React DOM
roots, and renderer integrations are diagnosed. Replace class error boundaries
with Vidact's function/owner error boundary and root error callbacks.

Components construct once per mount. Updates publish compiler-selected DOM,
range, effect, and child-prop operations; the component function is not rerun to
diff a Virtual DOM. Render-time side effects and opaque reads that relied on
rerenders must move into supported effects or external-store subscriptions.

## Account for deliberate event and scheduling differences

Handlers receive native DOM events, not SyntheticEvents. Use standard DOM event
fields and physical bubbling; portal ownership is logical, while event bubbling
follows the physical DOM tree.

Default updates are synchronous and atomic. Use the `concurrent` feature for
transitions, deferred values, and `flushSync`; Vidact does not approximate those
semantics with timeouts. Development checks do not reproduce Strict Mode's
exact double invocation, and `memo` is a compiler/invalidation hint rather than
a whole-component rerender wrapper.

## Enable cross-cutting features explicitly

Select only the families used by the application:

- `unsafe-html` for `dangerouslySetInnerHTML` and application-owned Trusted Types policy;
- `css-insertion` for `useInsertionEffect`;
- `async` for `lazy`, promises passed to `use`, and Suspense;
- `concurrent` for interruptible/deferred scheduling;
- `actions` for Action hooks and function form actions;
- `retained-ui` for Activity lifecycle;
- `profiling` for Profiler, debug values, and owner stacks;
- `framework` for streaming/static continuation APIs, cache lifetimes, metadata,
  resource hints, Server Components, and Server Functions.

Disabled feature use fails at its original source span and names the smallest
enabling flag. Client bundles omit unused feature and DOM capability modules.

## Split server and framework trust boundaries

Server output escapes text and attributes. Raw HTML remains an explicit
injection sink. Framework payload checksums detect corruption and version skew,
not hostile senders; applications still own authentication, authorization,
CSRF/origin protection, replay policy, and the Server Function registry.

Capture `cacheSignal()` synchronously before awaiting inside a cached async
operation when targeting both Web and Node hosts.

## Verify the migration

Run the compiled browser corpus in Chromium, Firefox, and WebKit, then exercise
SSR/hydration with the same protocol version. `pnpm check` also validates clean
package installs, source maps, size reachability, compiler cold/incremental
performance, runtime throughput, allocation bounds, and owner disposal.

Production `Vnnn` failures map to the matching runtime version's catalog in
[Development diagnostics and production error codes](../architecture/development-diagnostics-and-production-error-codes.md).
