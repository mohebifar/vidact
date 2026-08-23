# Compiler-owned memo and callback identity

- Decision state: Accepted
- Decided: 2026-08-23

## Context

Vidact constructs each component once, so it cannot preserve `useMemo` and
`useCallback` identity by replaying a hook list on component rerenders. Simply
inlining these hooks would produce correct scalar values but break observable
identity when a memo crosses a component-prop or effect dependency boundary.

## Decision

`useMemo` and `useCallback` are default-core, usage-reachable compiler
capabilities. The compiler recognizes named, aliased, and namespace React
imports and requires a fixed-length inline dependency array. Each hook lowers
to a compiler-owned source slot with a static read mask and its own write mask.

The runtime evaluates the factory once at construction and again only when a
dependency changes by pairwise `Object.is`. A changed value replaces the slot
and publishes its write source so downstream DOM bindings, component props,
effects, and other derivations update through the ordinary scheduler. An
unrelated source update preserves the exact cached object or function.

Reactive values captured by memo factories and callbacks are snapshotted for
each evaluation. Compiler-reserved snapshot bindings cannot shadow the state
slot used by a captured setter, so a callback may read a render-equivalent
value and still dispatch through the stable live setter.

## Compiler and runtime contract

- `createCompiledMemo(scope, reads, writes, evaluate, readDependencies)` owns
  one cached slot and one removable updater.
- `evaluate()` returns the next memo value or callback with reactive captures
  frozen for that dependency epoch.
- The memo declaration is excluded from ordinary eager derived-expression
  lowering; all later references read the memo slot.
- Owner disposal removes the memo updater. The capability is absent from chunks
  that do not use either hook.
- Direct runtime exports of `useMemo` and `useCallback` are compatibility
  shims for residual non-component code; compiled component calls never reach
  them.

## Invariants

- Construction evaluates each memo factory exactly once.
- Dependency-equal updates preserve `Object.is` identity and publish no memo
  source write.
- Dependency changes publish one fresh cached value before downstream readers
  observe the update.
- Callback closures observe the state snapshot for the dependency epoch while
  setters continue to target the live state slot.
- Memo values are observable dependencies for compiled effects and component
  prop bridges.

## Alternatives considered

- **Compile hooks away unconditionally:** smaller, but observably changes
  identity at effect and child-component boundaries.
- **Rerun the component with a hook index:** conflicts with construct-once
  components and reintroduces a renderer lifecycle.
- **Cache by source mask alone:** skips necessary `Object.is` comparisons when
  a subscribed source changes without changing the declared dependency value.

## Consequences

React-shaped memoization composes with Vidact's static dataflow without a hook
dispatcher. Dynamic dependency arrays, custom-hook hook ordering, and compiler
proofs that erase unobservable memo identity remain separate follow-up work.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` verifies semantic hook
  lowering, cached source slots, dependency readers, and collision-free setter
  snapshots.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/memo-callback.tsx`
  records both hooks in the accepted syntax contract.
- `tests/browser/corpus/apps/memo-callback/MemoCallbackApp.browser.test.ts`
  proves stable identity on unrelated writes, fresh identity on dependency
  changes, correct callback state, and surgical DOM mutation envelopes.
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/browser-corpus test`
- `pnpm size`
