# Vidact Start file-route lifecycle

- Decision state: Accepted
- Decided: 2026-08-24
- Builds on: [Framework streaming, continuations, and trust boundaries](framework-streaming-continuations-and-trust-boundaries.md)
- Builds on: [Owner-safe root replacement and HMR](owner-safe-root-replacement-and-hmr.md)

## Context

The framework runtime supplies rendering, hydration, serialization, request
caches, client references, and Server Function primitives, but deliberately does
not choose an application route graph or server lifecycle. Applications such as
the shop therefore have to repeat their own URL dispatch, Vite SSR environments,
document rendering, client entry, and Node adapter.

Vidact needs a native application layer rather than compatibility with Next.js
or TanStack Start internals. The first layer must preserve the separate server
and hydrate compiler targets, use the existing Vidact ownership protocols, and
remain deployable through the Web `Request`/`Response` interface.

## Decision

`@vidact/start` owns the first Vidact-native full-stack request lifecycle. Route
source files live under `src/routes` by default and export a `Route` created by
`defineFileRoute`. The Vite plugin discovers only reachable route source files
and generates `virtual:vidact-start/routes`; it does not scan application imports
for routing conventions at runtime.

Directory and filename segments determine the URL pattern:

- `__root` and `index` add no path segment;
- `$name` becomes a named parameter;
- `$` becomes a non-empty trailing splat; and
- segments prefixed with `_` are pathless layout segments.

Parent identity is explicit in the generated manifest. A matching request picks
the exact route with the highest static, parameter, then splat specificity and
composes its declared parent chain from the leaf outward. Route modules load in
parallel; loaders execute sequentially from root to leaf so each descendant gets
a frozen record of already loaded parent data.

A loader may throw a Web `Response` to terminate UI rendering with an explicit
HTTP result, such as a content-backed `404`. The Start handler returns that
response unchanged instead of wrapping it as an internal server error.

The leaf route may expose Web request handlers by HTTP method. A matching handler
runs before UI loaders. Unsupported methods return `405` with the methods actually
available from handlers and UI rendering. `HEAD` may use a `GET` endpoint but
never publishes its response body. Routes without a handler render only for
`GET` and `HEAD`.

`createStartHandler` is a host-neutral `(Request) => Promise<Response>` adapter.
It server-renders the matched component chain, emits a script-safe
`vidact-start-v1` snapshot using the closed `vidact-framework-v1` serializer, and
includes the request path and query plus each route's loader result. Hydration
loads the same generated route modules, consumes the supplied loader results
without rerunning loaders, reconstructs the same component chain, and claims the
whole server root through the existing hydrate runtime.

`Link` renders an ordinary anchor in both targets and adds private navigation
attributes unless `reloadDocument` is requested. After hydration, one delegated
click listener intercepts only unmodified, primary-button, same-origin HTTP(S)
links without downloads, external relations, non-self targets, or hash-only
changes. External and excluded links retain native anchor behavior.

A client navigation sends `x-vidact-start-navigation: 1` to the matched URL. The
server executes the same root-to-leaf loaders but returns only a script-safe
`application/x-vidact-start+json` snapshot; server-only loaders never execute in
the browser. The client imports the matched route modules, supplies the snapshot
data without rerunning loaders, and uses the compiled root's failure-atomic
`replace` operation. Only after successful replacement does it push or replace
history and apply scroll behavior. A newer navigation aborts the previous fetch
and invalidates all later work from that attempt. `popstate` performs the same
route replacement without writing another history entry.

Programmatic navigation is exposed by the `StartClient` returned from
`hydrateStart()`. Unmatched URLs, non-Start response media, server failures, and
cross-origin targets fall back to full document navigation, preserving
progressive enhancement.

`vidactStart()` installs separate Vite compiler instances for the `client`
hydrate environment and `ssr` server environment, always enabling the framework
feature. In development it also treats `/src/server.ts` as a conventional module
whose default export is a Web request handler, adapts Node requests and responses,
and passes HTML through Vite's document transform. Applications can disable that
adapter or select a different entry/export. Production remains two explicit Vite
builds, one client and one SSR entry, followed by a host adapter.

## Compiler and runtime contract

- Route components are top-level named functions. This makes their source span
  visible to React Compiler analysis and Vidact lowering; anonymous callbacks in
  a route options object are not accepted as component entry points.
- The route manifest imports the same route files separately in the hydrate and
  server environments. Target-specific Vite plugin instances must never share a
  compilation cache or emitted runtime entry.
- `RouteComponentProps<LoaderData>` carries typed loader data, decoded parameters,
  the request URL, and the next compiled child range for layout composition.
- Loader values must fit the framework serializer's closed value model. Snapshot
  checksums detect corruption and version skew, not authenticity.
- Server composition produces Vidact server children; client composition produces
  compiled renderables. Both enter the existing versioned server-marker and
  whole-root hydration protocol rather than a framework-specific DOM owner.
- The default and custom document paths receive a snapshot already escaped for
  an HTML script-text context. Custom documents remain responsible for all other
  HTML attribute and markup escaping.

## Invariants

- Server rendering and hydration select the same ordered route chain for one
  path and manifest.
- A loader runs at most once during the initial server-to-client lifecycle.
- A navigation loader runs on the server, never again while applying its client
  snapshot.
- Parent loaders settle before descendant loaders and expose only prior data.
- Endpoint dispatch never runs unrelated UI loaders.
- A loader-thrown Web `Response` preserves its status, headers, and body.
- Query text survives the snapshot and becomes part of the hydration request URL.
- Untrusted loader data cannot terminate the snapshot script element.
- Route-module changes invalidate the virtual module and trigger a development
  reload.
- Superseded navigation work cannot publish a route or history entry.
- `Link` remains a valid anchor before hydration and for every excluded click.
- Framework routing introduces no React renderer, React element tree, or client
  reconciler.

## Alternatives considered

- **Run Next.js or TanStack Start unchanged:** their renderer integrations,
  module conventions, streaming instructions, and client-router assumptions are
  not public portability layers for Vidact.
- **Put routing into `packages/runtime/src/framework.ts`:** matching, file
  discovery, Vite environments, and HTTP dispatch are application-framework
  policy. Keeping them in `@vidact/start` preserves the runtime's lower-level
  protocol boundary.
- **Run loaders again during hydration:** this duplicates side effects and can
  produce markup/data drift. The server snapshot is the initial loader authority.
- **Compile route files once for both environments:** server JSX and hydration
  ownership require different compiler targets and runtime imports.
- **Run universal loaders directly in the browser:** this would expose
  server-only code and duplicate the initial request model. A narrow snapshot
  response keeps loader authority on the server.
- **Fetch and parse a complete HTML document:** this preserves server authority
  but transfers and renders markup that failure-atomic client root replacement
  does not consume.
- **Intercept every anchor:** downloads, external targets, modifier gestures,
  hash navigation, and explicit document reloads belong to native browser
  behavior.

## Consequences

Vidact applications now have one file-route manifest and request lifecycle for
nested layouts, typed loaders, endpoint handlers, SSR, hydration, and
same-document navigation. Links remain progressively enhanced anchors. The Vite
development path no longer requires application-specific Node middleware, while
deployment hosts can keep using standard Web handlers.

This release does not yet include route preloading, pending or error route
components, middleware, mutations/actions integration, metadata merging, static
route generation, deployment adapters, build-manifest asset hashing, scroll
position restoration, retained shared-layout owners, or incremental boundary
streaming. The current failure-atomic root replacement resets component-local
state throughout the route chain. Adding retained layouts must preserve
route-owner disposal, request cancellation, loader authority, and the existing
framework trust boundary.

## Verification

- `packages/start/test/router.test.ts` covers specificity, parameters, parent
  chains, loader ordering, loader-data typing, and layout composition.
- `packages/start/test/server.test.ts` covers nested SSR, query and navigation
  snapshots, endpoints, `HEAD`, method negotiation, missing routes,
  loader-thrown responses, and script-text safety.
- `packages/start/test/link.test.ts` covers progressively enhanced server anchor
  output, `replace`, and `reloadDocument`.
- `packages/start/test/vite.test.ts` covers file conventions and environment
  plugin composition.
- `examples/start/test/server.test.ts` imports the generated manifest and proves
  an SSR dynamic route plus a JSON endpoint.
- `pnpm --filter @vidact/start test`
- `pnpm --filter @vidact/start typecheck`
- `pnpm --filter @vidact/example-start test`
- `pnpm --filter @vidact/example-start typecheck`
- `pnpm --filter @vidact/example-start build`
