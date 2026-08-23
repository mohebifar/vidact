# Aligned render slots and identity dispatch

- Decision state: Accepted
- Decided: 2026-08-22

## Context

Normalized render flow identifies alternatives, but the runtime still needs to
distinguish an update to one logical position from replacement of that
position. Remounting every branch would discard component state, focus, refs,
and keyed descendants. A general element-tree reconciler would preserve more
cases, but would recreate the runtime representation and diffing cost that
Vidact deliberately avoids.

React Compiler supplies control-flow and dependency facts. It does not define
DOM property reset behavior, event-listener ownership, component ranges, or
React's type/key/position identity policy, so these remain Vidact contracts.

## Decision

The compiler recursively merges alternatives whose logical position, static
type, and static key match. It emits one host or component construction and
turns branch-varying props into ordinary compiled bindings. Prop absence is an
`undefined` value, allowing the direct DOM target or child prop slot to apply
its reset/default behavior. Reactive event props use the same binding shape,
but applying a new value owns a cleanup that detaches the previous listener
before the old branch can act again.

Alternatives that do not align compile to an owned `choose` range. A JSX
position with a reactive key compiles to the narrower `dispatch` range. The
dispatcher subscribes only to the statically supplied identity dependencies,
retains the mounted owner while `Object.is(type, previousType)` and
`Object.is(key, previousKey)` both hold, and stages exactly one replacement
when either changes. The render closure is a mount factory for that position,
not a component-body replay or a runtime element descriptor.

Replacement is failure-atomic at the range boundary: new nodes and refs are
staged under a fresh owner, published before the old owner is disposed, and
discarded if staging or ref attachment fails. The previously committed range
then remains live. Selector/identity updaters are registered before bindings
owned by the selected branch, so a branch that is leaving cannot receive a DOM
write during the same flush.

Branch-varying refs on an aligned host lower to a compiled ref binding. The
runtime attaches the next ref before clearing the previous one, rolls back a
failed attachment, and retains the host throughout. Slot-valued JSX component
callees lower through the same dispatcher: codegen reads the state/prop slot for
identity and invokes it through a generated local JSX binding inside the staged
render factory. Function-valued prop bridges use exact replacement so the
callable is not invoked until that render factory runs.

## Invariants

- Equal position/type/key retains the exact host and component-owned nodes.
- A key or type change creates one new owner and disposes one previous owner.
- A component type carried through a state or prop slot retains its subtree when
  identity is stable and remounts exactly that dispatched range when it changes.
- A retained branch updates through static bindings; the dispatcher does not
  rerun its render factory for ordinary prop or child changes.
- Event replacement and removal leave at most one active listener, and owner
  disposal detaches static and reactive listeners.
- Ref replacement transfers cleanup without replacing the host; a failed next
  attachment leaves the prior ref active.
- Failed replacement does not detach the previous handler or refs and does not
  leak the staged owner.
- `choose` and `dispatch` are named ESM capabilities imported only when emitted.
- No runtime Virtual DOM, element tree, dependency discovery, or component-body
  replay is introduced.

## Alternatives considered

- **Always remount alternatives:** small compiler, but observably loses state,
  focus, refs, and descendant identity when React would retain them.
- **General runtime reconciliation:** broad dynamic support, but adds an element
  representation, tree diffing, and bundle/runtime cost.
- **Compile only static identity:** avoids a helper, but rejects ordinary
  dynamic keys and cannot safely handle unresolved component identity.
- **Mutate the old range before staging:** fewer temporary nodes, but a thrown
  render or ref can corrupt the last committed result.

## Consequences

Common conditional prop and event changes are surgical and pay no child-list
mutation. True identity changes pay for one small pair of range markers and one
feature-level dispatcher. The compiler must keep expanding explicit DOM reset
semantics rather than treating arbitrary JSX objects as reconcilable values.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` proves aligned emission,
  helper tree shaking, dynamic-key dispatch, reactive ref bindings, and precise
  component-type diagnostics.
- `packages/runtime/test/reactivity/component-ranges.browser.test.ts` proves
  retained dispatch identity, key replacement, event cleanup, and failed
  replacement rollback.
- `tests/browser/corpus/apps/control-flow/` proves repeated aligned and divergent
  transitions, local component state, focus, nested keyed-row identity, dynamic
  key remounting, terminal switch selection, disposed-listener inactivity, and
  MutationObserver envelopes through the Vite compiler path.
- Run `cargo test -p vidact-compiler`, `pnpm test:runtime`,
  `pnpm test:browser`, and `pnpm typecheck`.
