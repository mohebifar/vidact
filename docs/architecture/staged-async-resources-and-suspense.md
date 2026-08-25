# Staged async resources and Suspense

- Decision state: Accepted
- Decided: 2026-08-23
- Superseded in part by: [Capability-owned runtime entrypoints](capability-owned-runtime-entrypoints.md)

## Context

React-shaped `lazy`, `use(promise)`, and `<Suspense>` require more than catching
an arbitrary thrown promise. JSX normally evaluates component children before a
boundary function runs, and direct DOM construction may already have created
nodes, refs, effects, scopes, or component markers by the time a promise is
observed. Publishing any of that partial work would violate Vidact's owner and
failure-atomicity contracts.

Server rendering and hydration add another ordering problem. A pending server
boundary does not emit the component ranges inside its abandoned content, so a
hydrate target cannot probe that content through the ordinary claiming cursor.

## Decision

The `async` compiler feature enables `lazy`, promise inputs to `use`, and
`<Suspense>`. The compiler rewrites every React `Suspense` fallback and child
body into render factories before automatic JSX lowering. This delays content
construction until the boundary has created a staged owner. Disabled Suspense
and lazy syntax fail at their source spans and name the `async` feature.

Raw promises map to stable resource records by object identity. A record moves
once from pending to fulfilled or rejected and notifies only subscribed live
boundaries. `createResource` exposes the same record contract to applications
and accepts an optional cancellation callback. Cancellation runs when the last
pending boundary abandons the record. `lazy` creates one cached module resource
on first use and validates its default component export.

`use(resource)` reads fulfilled values, throws rejected reasons into the normal
error-owner route, and signals pending work with a private branded suspension
record. Suspense catches only that brand. Arbitrary thrown promises are not a
control-flow protocol.

Each Suspense attempt constructs content under a fresh owner and detached
document fragment. Successful content commits before the previous fallback or
content owner disposes. Pending attempts dispose all staged work, subscribe to
one resource, and publish a separately owned fallback. Retry generations and
owner disposal suppress stale resolution. Nested boundaries handle their own
resources; rejected retries route through the nearest function error boundary
or root callback.

The synchronous server target renders fulfilled records as content and pending
records as fallback. Hydratable pending output carries a
`<!--vidact:v1:p-->` marker inside the ordinary child-slot range. The hydrate
runtime consumes that marker and probes content with hydration temporarily
disabled, so missing descendant component markers cannot corrupt the global
claim cursor. A matching pending fallback is claimed with zero DOM mutation.
Once fulfilled, content publishes atomically and removes the pending marker and
fallback range. Fulfilled server boundaries use normal component and child-slot
claiming, including nested component ranges ordered by opening position.

Async code is reached through `@vidact/runtime/async`,
`@vidact/runtime/async/hydrate`, and `@vidact/runtime/async/server`. Enabling an
unused feature changes compiler configuration and entry selection but leaves
unused async machinery tree-shakeable from client chunks.

## Invariants

- A suspended attempt never publishes nodes, refs, effects, or owners.
- Only branded resource suspension is caught; ordinary exceptions keep their
  existing boundary semantics.
- One lazy factory invocation creates one module resource.
- A disposed boundary cannot publish a later resolution.
- Pending and fulfilled server markup have deterministic hydrate behavior.
- Client-only builds do not import server serialization or hydration scanning.
- Promise identity must remain stable for the lifetime of an attempt; framework
  caches or application resource records own cross-attempt deduplication.

## Consequences

Suspense remains an explicit opt-in capability and adds no scheduler. Content
retries run when resources settle; interruptible priority and retained stale UI
belong to the later `concurrent` feature. The server string APIs do not wait for
pending resources. Waiting, streaming, abort, and continuation policies belong
to the `framework` target built on this resource record.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` covers exact feature gates,
  promise-use lowering, staged JSX factories, and lazy calls.
- `crates/vidact-compiler/tests/server_codegen.rs` covers server feature gating
  and preservation of boundary factories.
- `packages/runtime/test/async/resources.browser.test.ts` covers reveal,
  rejection, nested boundaries, lazy deduplication, cancellation, and unmount
  races in Chromium, Firefox, and WebKit.
- `packages/runtime/test/server/server.test.tsx` covers deterministic pending and
  fulfilled server resources plus lazy deduplication.
- `tests/browser/corpus/async-hydration/AsyncHydrationApp.browser.test.ts` proves
  zero-mutation pending and fulfilled hydration, fallback identity, and atomic
  reveal in all three browser engines.
