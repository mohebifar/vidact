# Interruptible transition publication

- Decision state: Accepted
- Decided: 2026-08-23

## Context

Vidact's default scheduler deliberately publishes state synchronously. React-shaped
`startTransition`, `useTransition`, and `useDeferredValue` require a different
contract: urgent work must remain observable while deferred work is waiting,
newer work must invalidate stale results, and a transition touching several
sources must not expose a partially updated DOM. Deferring a setter with a timer
would provide none of those guarantees.

## Decision

The `concurrent` compiler feature lowers `useTransition` and
`useDeferredValue` into scheduler-owned state slots. `startTransition` and
`flushSync` remain public calls routed through isolated concurrent runtime
entries. Without the feature, all four APIs fail at their original call spans.

The scheduler has urgent and deferred queues. Urgent state writes keep the
default synchronous path. A transition action runs immediately but records its
state-slot writes without changing visible values. Deferred work is scheduled
through a `MessageChannel` turn so another browser task can run first; test
`act` drains the same queue deterministically.

Each transition lane has a monotonically increasing generation. Starting newer
work cancels the older scheduled unit. Every touched state slot also records its
revision. An urgent write to any touched slot makes the whole deferred unit
stale, so it is discarded rather than rebased onto an unobserved snapshot.

A live unit applies all queued state updates inside one global compiled
transaction. Static updaters across scopes finish before the existing
transactional DOM publication commits, so bindings observe one consistent set
of values. Functional updates retain source order within a slot. The pending
slot changes urgently before scheduling and clears only after the current lane
settles. `useDeferredValue` uses the same generation, revision, and publication
machinery rather than a separate timeout policy.

`flushSync` temporarily selects the urgent lane, executes its callback, and
drains queued Vidact work. It exists only in concurrent runtime facades.

Concurrent code is reachable through `@vidact/runtime/concurrent` and its
hydrate/server variants. Async and concurrent features compose through
`@vidact/runtime/async/concurrent` variants. Installing the state-write
interceptor is lazy, so enabling but not using the feature produces exactly the
same client artifact as the default build.

## Invariants

- Urgent writes never wait behind deferred work.
- A stale or superseded transition cannot publish any of its state or DOM work.
- All writes from one live transition publish through one compiled transaction.
- Pending state describes only the newest unit on its transition lane.
- Deferred values use the transition scheduler and cannot regress to an older
  source revision.
- The default runtime remains synchronous and contains no deferred queue.

## Consequences

Vidact provides useful interruptible interaction semantics without claiming a
Fiber renderer or arbitrary time-sliced component execution. A scheduled static
update unit can be canceled before it begins; once its bounded synchronous
updaters start, they run through one atomic publication. Long user computations
inside a transition action remain ordinary blocking JavaScript.

Actions build on these lanes for pending state, sequential async queues, and
optimistic rollback/rebase. Suspense may later retain already-visible content
during a transition, but resource staging remains owned by the separate
`async` feature.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` covers lowering and exact
  feature gates.
- `crates/vidact-compiler/tests/fixtures/compatibility` records accepted and
  rejected concurrent surfaces.
- `packages/runtime/test/concurrent/transitions.browser.test.ts` covers atomic
  batches, functional update order, supersession, urgent invalidation,
  deferred values, and `flushSync`.
- `tests/browser/corpus/concurrent/ConcurrentApp.browser.test.ts` proves urgent
  preemption, stale suppression, and node identity in Chromium, Firefox, and
  WebKit.
- `tests/runtime-size/measure.mjs` enforces zero bytes for an unused opt-in and a
  9,734-byte gzip ceiling for the representative concurrent app.
