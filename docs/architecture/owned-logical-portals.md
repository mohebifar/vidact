# Owned logical portals

- Decision state: Accepted
- Decided: 2026-08-23

## Context

A portal renders a logical descendant into another DOM container. Constructing
its physical nodes eagerly would leak DOM before the root or updater transaction
commits. Treating it as a separate root would lose provider values, error
ancestry, deterministic IDs, and disposal with its source branch.

React also bubbles portal events through its synthetic logical tree. Vidact's
event contract is native DOM events, so reproducing that behavior would require
a delegated synthetic propagation layer that the runtime intentionally does not
have.

## Decision

`createPortal(children, container, key?)` returns a single-mount structural
binding with a logical placeholder and a marker-owned physical range. It
captures the current context frame and root identity and constructs a dedicated
portal owner for the physical children.

During initial root construction, portal content stages in a detached fragment
and queues against the logical root. `mountCompiled` first publishes the root,
then publishes every pending portal, then commits refs and owner resources. A
portal created by a reactive branch stages its physical publication in the
current updater transaction. Failed construction or publication removes the
staged range and disposes the portal owner.

Branch or root cleanup disposes descendant scopes, refs, effects, and listeners
before removing the physical portal range and logical placeholder. Provider
bindings and source slots continue to update retained portal descendants
without remounting them.

Portal events follow native physical DOM bubbling. They bubble through the
portal container and document, not through the logical JSX parent. This is an
intentional, typed compatibility difference from React's synthetic portal event
contract.

## Invariants

- No portal node becomes visible before its logical root or updater transaction
  commits.
- Portal descendants inherit the logical context chain and root ID generator,
  independent of physical containment.
- Host refs attach and layout resources run only after the physical range is in
  its container.
- Provider updates retain portal nodes and local component state.
- Removing a conditional portal or unmounting its root empties the owned
  physical range exactly once.
- Invalid containers and attempts to mount one portal binding twice fail with
  stable diagnostics.

## Alternatives considered

- **Mount a separate root in the target:** loses logical context, IDs, cleanup,
  and source-graph ancestry.
- **Insert during component construction:** exposes abandoned work and breaks
  root failure atomicity.
- **Emulate React-tree event bubbling:** requires synthetic event delegation and
  conflicts with Vidact's documented native event values.

## Consequences

Portals compose with existing owners and static updates without a general
renderer. Dynamic container migration and keyed portal identity beyond the
compiler's surrounding list/branch identity remain follow-up refinements.

## Verification

- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/portal.tsx`
  records the native-bubbling compatibility difference.
- `packages/react-types/test/jsx-contract.tsx` verifies portal children accept
  Vidact owned values.
- `tests/browser/corpus/apps/portal/PortalApp.browser.test.ts` proves staged
  mount, context and ID ancestry, ref-before-layout timing, retained state,
  surgical provider updates, physical bubbling, branch remount, and cleanup.
- `pnpm --filter @vidact/browser-corpus test`
