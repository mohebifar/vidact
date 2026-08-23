# Deterministic test act draining

- Decision state: Accepted
- Decided: 2026-08-23

## Context

Compiled state, DOM publication, refs, and layout work are synchronous, but
passive effects and their cleanup use microtasks. Tests that await one generic
`Promise.resolve()` cannot prove stability when a passive effect schedules
state that schedules another passive run. React's `act` intent is useful, but
Vidact needs to drain its own scheduler rather than React's renderer queues.

## Decision

`@vidact/test-support` exports asynchronous `act(operation)`. While an act scope
is active, Vidact-owned passive tasks accumulate without an automatic microtask
flush. `act` awaits the operation, drains the queue, yields to native promise
microtasks, and repeats until both a drain pass and the queue are empty. Nested
act scopes share the same queue. A 100-pass guard reports work that does not
stabilize.

The runtime scheduler lives behind `@vidact/runtime/testing`; applications do
not receive the act coordinator. Normal effect scheduling still requests a
microtask automatically. The production size corpus is byte-for-byte unchanged
because fixtures without effects tree-shake the scheduler and no application
imports the testing subpath. A production effect fixture is 8,021 gzip bytes
against an 8,100-byte ceiling and reports zero rendered bytes from
`scheduler.ts`, proving the development coordinator folds back to native
`queueMicrotask`.

Callback errors are preserved after already-scheduled Vidact work is drained.
If scheduled work fails, the first failure is rethrown after the scheduler has
attempted every queued task. Errors caught by a logical boundary or root
callback do not escape `act`.

## Invariants

- Returning from `await act(...)` means no Vidact passive task is pending.
- Passive tasks may schedule state, cleanup, and more passive tasks in the same
  act scope.
- Synchronous DOM, ref, insertion, and layout publication remains synchronous;
  `act` does not defer it.
- Test coordination adds no code to production application chunks.
- Native promises are yielded to, but `act` does not claim to drain arbitrary
  timers, network operations, or foreign schedulers.

## Verification

- `packages/test-support/src/tests/act.browser.test.ts` proves initial effects,
  dependency cleanup/rerun, effect-scheduled state, async callbacks, disposal,
  and failure propagation.
- `tests/browser/corpus/apps/error-boundary/ErrorBoundaryApp.browser.test.ts`
  uses `act` to observe a compiled passive failure deterministically.
- `pnpm test:runtime`
- `pnpm test:browser`
- `pnpm size`
