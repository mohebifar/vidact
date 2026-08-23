# State slots, reducers, and disposal

- Decision state: Accepted
- Decided: 2026-08-23

## Context

Compiled `useState` already used a stable source-mask slot with lazy
initialization, functional updates, and transaction-aware invalidation. Retained
setters silently changed their closed-over value after the component owner was
disposed, however, and `useReducer` had no compiler/runtime ABI. Implementing a
separate reducer scheduler would duplicate batching, ownership, and failure
semantics.

## Decision

`useState` and `useReducer` are classified by resolved React import identity,
including aliases and namespace imports. Both declaration forms lower to one
compiler-assigned state source and one stable slot object. State reads become
`slot.get()`; setters and reducer dispatch functions become `slot.set(...)` in
generated code.

`createCompiledReducer` initializes the same state-slot primitive with either
the initial argument or the optional initializer result. Its stable `set`
method treats every input as an action and invokes the captured reducer inside
a functional state-slot update. A function-valued action is therefore still an
action rather than being mistaken for a `useState` updater.

Every compiled state and prop slot receives an owner-backed write guard. Once
the scope is disposed, a retained setter or dispatch throws before evaluating
the updater or reducer and before changing the closed-over value. Production
builds report this as `V012`. Scope disposal itself remains idempotent.

## Invariants

- A reducer and its initializer run only at their specified times; a component
  is never reinvoked to process an action.
- Dispatch identity is stable for the lifetime of the component.
- Reducer updates use the same source masks, batching, publication ordering,
  and stabilization limit as state updates.
- Function-valued reducer actions are passed to the reducer unchanged.
- State reset follows owner identity: keyed remount creates a new slot, while a
  keyed move retains the existing owner and slot.
- Writes after disposal cannot run user update code or mutate a dead slot.

## Alternatives considered

- **Implement reducers as compiler-expanded event code:** this would miss
  dispatches from callbacks and duplicate reducer semantics at every call site.
- **Expose a separate reducer scheduler:** this adds a second batching and
  ownership protocol without improving observable behavior.
- **Silently ignore post-disposal writes:** convenient for stale callbacks, but
  hides lifetime bugs and allows retained slot values to diverge invisibly.

## Consequences

`useReducer` is part of the default compiled core and inherits the established
state ABI. The generated import grows only when a component uses reducers.
Custom hooks and rules-of-hooks validation still require a shared hook-owner
contract; this decision does not imply runtime component replay.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs`
- `crates/vidact-compiler/tests/compatibility_corpus.rs`
- `packages/runtime/test/reactivity/static-updaters.browser.test.ts`
- `packages/runtime/test/lifecycle/disposal.browser.test.ts`
- `tests/browser/corpus/apps/counter/`
- `cargo test -p vidact-compiler`
- `pnpm --dir packages/runtime test`
- `pnpm --dir tests/browser test`
