# Compiled lifecycle effects and commit phases

- Decision state: Accepted
- Decided: 2026-08-23

## Context

Construct-once components cannot implement `useEffect` or `useLayoutEffect` by
rerunning the component and replaying hooks. Effects also cannot run during
construction: host refs and DOM mutations are not committed yet, dependency
changes need cleanup-before-rerun, and removed branches or rows must cancel
pending passive work.

React Compiler provides semantic source identities and dependency expressions,
but it does not own Vidact's DOM publication, owner cleanup, or scheduling.

## Decision

`useLayoutEffect` and `useEffect` are default-core, usage-reachable compiled
resources. The compiler recognizes named, aliased, and namespace React imports,
requires an inline fixed-length dependency array when one is supplied, and
emits a static source mask. An omitted array subscribes to every component
source; an empty array subscribes to none.

Each effect callback is rebuilt for a run with compiler-generated snapshots of
the reactive values it captures. Cleanup closures therefore retain the values
from the run that created them even though the component itself is never
reinvoked. Stable setters and nonreactive locals remain ordinary lexical
captures.

Initial layout effects enter the component owner commit queue after descendant
host refs publish. Reactive layout reruns are publication finalizers after DOM
mutation and imperative-handle replacement. Passive effects use a cancellable,
coalescing microtask after publication. Layout cleanup is synchronous on owner
disposal; passive cleanup is deferred to the passive phase.

## Compiler and runtime contract

- `compiledLayoutEffect(scope, reads, readCreate, readDependencies?)` owns a
  synchronous post-DOM resource.
- `compiledEffect(scope, reads, readCreate, readDependencies?)` owns a passive
  microtask resource.
- `readCreate()` returns a fresh callback whose reactive captures are snapshots
  for that run. Dependency comparison uses pairwise `Object.is` and static
  length.
- Reruns call the previous cleanup before the next callback. Owner disposal
  removes the updater, cancels stale scheduled runs, and calls cleanup once.
- A callback may return `undefined` or one cleanup function. Other values fail
  with the stable lifecycle error family.

Effect errors still propagate through the current synchronous or microtask
boundary. Routing them to function error boundaries and root error callbacks is
a later failure-boundary contract; this decision does not silently swallow
them.

## Invariants

- Host refs are attached before the first layout effect reads the DOM.
- A layout rerun sees committed DOM and follows imperative-handle publication.
- A passive run never executes for an owner disposed before its microtask.
- Cleanup observes the reactive snapshot from its own effect run.
- Dependency-equal updates do not clean up or rerun the effect.
- Removing a branch, keyed row, or root cleans each mounted effect exactly once.
- Applications without effects retain no effect scheduling code in measured
  production chunks.

## Alternatives considered

- **Rerun the component to replay hooks:** conflicts with construct-once
  components and would require a renderer-level hook index and returned-tree
  reconciliation.
- **Run effects during construction:** exposes detached DOM, precedes refs, and
  leaks work when staging fails.
- **Let cleanup read live slots:** makes a cleanup observe the next state rather
  than the render-equivalent snapshot that created it.
- **Schedule passive work with timers:** adds unnecessary latency and makes
  deterministic draining harder than a cancellable microtask phase.

## Consequences

Common subscription, measurement, and imperative-library effects now compose
with Vidact ownership without component reruns. The runtime pays scheduling
bytes only in chunks that import an effect capability. Custom hooks,
`useEffectEvent`, insertion effects, error routing, and a public `act` drain API
remain follow-up work on this phase model.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` verifies semantic import,
  source-mask, dependency-reader, and snapshot-factory lowering.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/effects.tsx`
  records effects in the accepted syntax contract.
- `tests/browser/corpus/apps/multi-component/MultiComponentApp.browser.test.ts`
  proves ref/DOM timing, dependency reruns, snapshot cleanup, and layout/passive
  disposal order.
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/browser-corpus test`
- `pnpm size`
