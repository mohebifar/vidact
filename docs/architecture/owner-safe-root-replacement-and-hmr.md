# Owner-safe root replacement and HMR

- Decision state: Accepted
- Decided: 2026-08-23

## Context

Vite can replace a compiled module while its previous component owners still
hold DOM ranges, listeners, refs, effects, portal publications, and external
subscriptions. Removing old DOM before the replacement constructs creates a
blank or partially disposed application. Reusing old compiler-local state slots
against a changed updater graph is unsafe without a versioned state schema.

## Decision

Every client and hydration root supports `replace(application)`. Replacement
constructs and mounts the new compiled root while the previous owner is still
valid. After the new root publishes successfully, the previous owner disposes
exactly once. If replacement construction fails, the previous root remains the
active root.

`mountHotRoot(import.meta.hot, host, application)` stores that root in Vite hot
data, accepts the module, replaces it on the next evaluation, and unmounts it
when Vite prunes the module. Ordinary root options and error routing remain in
effect.

The preservation boundary is explicit:

- component-local compiled state, refs, and effects reset on replacement;
- state in an external store survives when the replacement subscribes to the
  same store;
- DOM identity is not promised across module replacement;
- owners, listeners, refs, effects, portals, and subscriptions never survive
  after their old root is disposed.

State-preserving local HMR requires a future compiler-emitted schema that can
prove source-slot compatibility. Vidact does not retain slots by position or
name heuristics.

## Consequences

Hot replacement is owner-safe today and fails closed when compiled structure
changes. It does not pretend that arbitrary source edits preserve local state.
Applications that need preservation during development can place that state in
a stable external store, which is already part of the default compatibility
contract.

## Verification

`packages/runtime/test/lifecycle/root.browser.test.ts` replaces a live stateful
root, proves local-state reset, verifies old layout cleanup exactly once, and
verifies prune unmounts the replacement owner.
