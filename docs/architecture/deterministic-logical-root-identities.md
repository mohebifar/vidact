# Deterministic logical-root identities

- Decision state: Accepted
- Decided: 2026-08-23

## Context

`useId` must remain stable across ordinary updates, avoid collisions between
roots, support application-supplied prefixes, and eventually produce the same
sequence during server rendering and hydration. Vidact also constructs branch
and list descendants after initial mount, when no root call is on the stack.

A process-global counter alone would make late work order-dependent across
roots. An owner-local counter would duplicate IDs in every child component.

## Decision

Each mounted logical root owns one mutable identity record containing an
`identifierPrefix` and monotonic ID counter. `mountCompiled` accepts an optional
`identifierPrefix`; otherwise the client allocates a process-unique root prefix.
Every descendant owner shares the same identity record.

The compiler recognizes semantic direct `useId()` declarations and lowers them
to `createCompiledId(scope)`. IDs use the deterministic form
`:<identifierPrefix>r<ordinal>:`. They are plain construct-once strings rather
than reactive sources.

Structural blocks and subscriptions capture and restore root identity alongside
logical context. Descendants created by later conditional, list, binding, or
dispatch work therefore continue the original root sequence. Removing and
remounting an owner allocates new ordinals, while ordinary state updates retain
the owner's existing strings.

## Invariants

- Calls in one root receive strictly increasing ordinals in construction order.
- Different default client roots receive different prefixes.
- An explicit prefix is preserved byte-for-byte and controls multi-root
  coordination at the application boundary.
- Child components and late structural descendants share their logical root's
  generator regardless of physical DOM placement.
- State, prop, context, external-store, and memo updates never change an
  existing owner's IDs.
- `useId` arguments and residual non-declaration calls are diagnosed.

## Alternatives considered

- **One process-global ID counter:** avoids duplicates but prevents deterministic
  per-root server/client replay.
- **One counter per component owner:** duplicates IDs across sibling components
  and breaks label/ARIA relationships when composed.
- **Random IDs:** avoid most collisions but cannot hydrate deterministically and
  make tests and snapshots unstable.

## Consequences

The client root now has a deterministic identity input reusable by the future
server emitter and hydration claimant. The server target must seed the same
prefix and construction order; streaming segment allocation remains a later
framework concern.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` verifies semantic lowering
  and nonreactive ID declarations.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/use-id.tsx`
  records `useId` in the accepted syntax contract.
- `tests/browser/corpus/apps/use-id/UseIdApp.browser.test.ts` proves explicit
  prefixes, label/ARIA relationships, update stability, late allocation,
  remount allocation, and independent roots.
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/browser-corpus test`
