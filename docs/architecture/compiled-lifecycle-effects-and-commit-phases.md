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

`useEffectEvent` lowers to one owner-bound stable function. Its callback is not
snapshotted: compiler-rewritten prop, state, context, and external-source reads
remain live slot reads whenever an external system invokes it. The compiler
allows the function to be referenced only inside an inline effect callback,
which supports passing it to subscriptions without exposing it as a render or
DOM event handler. Calling a retained effect event after owner disposal fails.

`useInsertionEffect` is an explicit `css-insertion` compatibility feature. It
uses the same static dependency and snapshot contract as the other effect
hooks, but enters a dedicated synchronous insertion phase. Vidact completes
all insertion callbacks for a newly published node set before attaching any
refs in that set; refs then publish before layout resources. This ordering is
also preserved for reactive publications and structural replacements.

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
- `compiledInsertionEffect(scope, reads, readCreate, readDependencies?)` owns a
  synchronous pre-ref resource and is emitted only when `css-insertion` is
  enabled.
- `compiledEffect(scope, reads, readCreate, readDependencies?)` owns a passive
  microtask resource.
- `readCreate()` returns a fresh callback whose reactive captures are snapshots
  for that run. Dependency comparison uses pairwise `Object.is` and static
  length.
- Reruns call the previous cleanup before the next callback. Owner disposal
  removes the updater, cancels stale scheduled runs, and calls cleanup once.
- A callback may return `undefined` or one cleanup function. Other values fail
  with the stable lifecycle error family.
- `createCompiledEffectEvent(scope, callback)` returns one stable owner-bound
  function whose callback reads current slots rather than effect-run snapshots.

Effect errors route through the logical function boundary and root callback
contract. Synchronous layout failures enter that route after publication
rollback; passive failures enter it from their owned microtask.

## Invariants

- Host refs are attached before the first layout effect reads the DOM.
- Insertion effects run after host publication but before refs and layout
  effects; they therefore cannot observe an attached host ref.
- A layout rerun sees committed DOM and follows imperative-handle publication.
- A passive run never executes for an owner disposed before its microtask.
- Cleanup observes the reactive snapshot from its own effect run.
- Dependency-equal updates do not clean up or rerun the effect.
- Removing a branch, keyed row, or root cleans each mounted effect exactly once.
- Effect-event identity remains stable while its callback observes current
  reactive values, and retained calls fail after disposal.
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
bytes only in chunks that import an effect capability. Custom hooks and a
public `act` drain API remain follow-up work on this phase model.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` verifies semantic import,
  source-mask, dependency-reader, and snapshot-factory lowering.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/effects.tsx`
  records effects in the accepted syntax contract.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/effect-event.tsx`
  records live, stable effect events and compiler-enforced reference placement.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/insertion-effect.tsx`
  records the feature-gated insertion-effect contract.
- `tests/browser/corpus/apps/multi-component/MultiComponentApp.browser.test.ts`
  proves ref/DOM timing, dependency reruns, snapshot cleanup, and layout/passive
  disposal order.
- `tests/browser/corpus/apps/effect-event/EffectEventApp.browser.test.ts` proves
  stable subscription identity, live state reads, and post-disposal failure.
- `tests/browser/corpus/apps/insertion-effect/InsertionEffectApp.browser.test.ts`
  proves initial and reactive insertion → ref → layout ordering.
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/browser-corpus test`
- `pnpm size`
