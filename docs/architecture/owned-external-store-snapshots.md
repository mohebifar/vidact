# Owned external-store snapshots

- Decision state: Accepted
- Decided: 2026-08-23

## Context

Routers and state libraries expose data outside Vidact's source slots. Reading
an external snapshot only during construct-once component setup would become
stale, while subscribing before a usable snapshot exists or failing to recheck
after subscription creates a read/subscribe tear.

React's `useSyncExternalStore` also accepts a server snapshot. The client
contract must carry that callback without pretending the current browser
runtime performs hydration.

## Decision

The compiler recognizes semantic `useSyncExternalStore` calls in direct
component declarations, assigns a synthetic external source, and lowers them
to `createCompiledExternalStore(scope, source, subscribe, getSnapshot,
getServerSnapshot?)`. Hook arguments must currently be nonreactive; captured
reactive subscribe or snapshot functions are diagnosed until resubscription is
modeled explicitly.

The runtime reads the initial snapshot, creates a consumer-local state slot,
subscribes, and immediately reads again. The second read closes the mutation
window between the first read and listener registration. Store notifications
read inside the consumer scope's batch and replace the slot only when
`Object.is` observes a new snapshot.

The unsubscribe function belongs to the component owner. Disposal disables the
listener before calling unsubscribe, so a misbehaving store that retains the
callback cannot write into a disposed component. Construction failure during
the atomic recheck unsubscribes before propagating the error.

## Invariants

- A mounted consumer reflects a store mutation that occurs during subscribe,
  even when the store emits no notification for that mutation.
- Equal snapshots publish no external source write.
- Unrelated component sources neither call `getSnapshot` nor touch the
  consumer's DOM bindings.
- Every successful subscription is unsubscribed exactly once with owner
  disposal.
- Notifications after disposal are ignored even if the external store violates
  its unsubscribe contract.
- `getServerSnapshot` is preserved in generated client code but remains unused
  until the server/hydration target owns its semantics.

## Alternatives considered

- **Read once without subscribing:** incompatible with state libraries and
  routers because construct-once values never refresh.
- **Subscribe without a second read:** permits a missed update between the
  initial snapshot and listener registration.
- **Invalidate the component's full source mask:** wakes unrelated bindings and
  loses the compiler's consumer-level dependency graph.
- **Silently retain reactive hook arguments:** cannot preserve React's
  unsubscribe/resubscribe behavior when their identity changes.

## Consequences

External stores enter Vidact through one equality-checked source slot and reuse
ordinary binding, prop, memo, and effect propagation. Cross-consumer batching,
reactive resubscription, error-boundary routing, and server snapshot selection
remain follow-ups on the root scheduler and hydration contracts.

The local shadcn Popover demonstrates the bounded application pattern. A
framework-neutral observer is constructed inside the Popover root, and that
root makes the only direct `useSyncExternalStore` call. Compiled context carries
the current snapshot and imperative actions to child owners. Calling the hook
from those consumers with context-derived methods remains unsupported because
those arguments are reactive and would require resubscription lowering.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` verifies semantic lowering,
  synthetic source allocation, and slot reads.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/sync-external-store.tsx`
  records the hook in the accepted syntax contract.
- `tests/browser/corpus/apps/external-store/ExternalStoreApp.browser.test.ts`
  proves subscribe-time rechecking, surgical publication, unrelated-source
  isolation, and disposal unsubscribe behavior.
- `examples/docs/src/PopoverProof.browser.test.ts` proves the one-root-
  subscription pattern across controlled state, a portal open interval, and
  owner disposal.
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/browser-corpus test`
