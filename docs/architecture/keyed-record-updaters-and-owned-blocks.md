# Keyed record updaters and owned blocks

- Decision state: Accepted
- Decided: 2026-08-21

## Context

The first surgical runtime reused a keyed record only when both its key and item object were unchanged. Replacing `{ id: 1, title: "old" }` with `{ id: 1, title: "new" }` therefore disposed the record and mounted a new DOM subtree even though the stable key still identified the same row. It also represented keyed and conditional output as structural bindings without an explicit single-owner mount rule.

React Compiler analysis can identify component-level reactive inputs, but it does not decide list keys, DOM ranges, row ownership, or how a JSX expression maps to a concrete node property. Vidact needs those contracts in its own lowering and runtime.

## Decision

A compiled keyed record is identified only by its key. Each record owns its DOM nodes, cleanup owner, compact item updater scope, current-item cell, and a current-index cell only when the callback declares an index parameter. When the same key receives a new object or tracked position, `keyed` writes the new values into those cells and generated bindings update the retained DOM. A changed or removed key disposes the old record.

The OXC lowering uses semantic `SymbolId`s for keyed callback parameters. It rewrites item and index references to slot reads and classifies each JSX binding into a component-source mask, an item-source mask, or both. The runtime statically registers the emitted updater against those masks. It does not discover dependencies while evaluating the expression, so these slots are Vidact-style updaters rather than signals.

An exact item identity or direct property path used as the row key is invariant
for that record owner's lifetime. When the same semantic item reference appears
again inside the keyed callback, including a scalar structural-choice branch,
the compiler emits its slot read without a binding or item-scope subscription.
If that key value changes, keyed reconciliation removes the old owner and mounts
a new record before an in-place item update could be observed.

A keyed or conditional structural result is an owned block. The block may pass through props and be rendered as a child, including the compiled form of `<div>{props.arrayOfJsx}</div>`, but it may mount only once. This supports arrays produced by Vidact compilation; it does not make arbitrary external `ReactElement[]` values renderable.

## Compiler and runtime contract

The generated keyed callback receives `(itemSlot, indexSlot, itemScope)`.
References to identifier-form source parameters become `.get()` calls. A
supported object-destructured row parameter is replaced by one generated item
slot, and each leaf reference becomes a static property path from
`itemSlot.get()`. Top-level destructured key leaves compile to a separate raw-row
property selector, so key calculation still does not allocate slots before
reconciliation. Nested/default/rest/array row patterns remain diagnosed until
their key and default contracts are explicit.

Invariant-key matching uses the same `KeyPath::Identity` and
`KeyPath::Property` boundary as keyed-list analysis plus semantic `SymbolId`
equality. It applies to exact repeated item references and direct properties,
including supported destructured key leaves. Composite, computed, nested, and
mixed parent/item expressions keep their normal reactive bindings.

The compiler emits an index-tracking boolean in the private `keyed` call ABI.
Compiler-managed item and index inputs use read-only cells: they expose the
generated `.get()` shape and invalidate their fixed source mask on replacement,
without allocating public state setters. Those cells share one prototype-free
getter, use the cell itself as transition identity, and allocate revision
bookkeeping only if an intercepted write is staged. Their item scope uses a compact narrow scheduler whose
invalidation and disposal methods are shared across rows, and omits removable
updater closures when the updater has the same lifetime as that row owner.
Internal keyed disposal accepts that scope directly so records do not retain a
row-specific wrapper closure. Manually authored runtime calls keep the full
`StateSlot` and general scope contract.

Compiler-generated inline row events retain only their logical owner and the
shared delegated invocation entrypoint. Delegated invocation establishes that
owner and the global compiled transaction; it does not retain the row scope as
separate event metadata. Row state writes still schedule their owning scope and
flush once the transaction ends.

`binding`, `when`, `keyed`, and `indexed` accept their component scope/mask
plus an optional item scope/mask. A nested list whose collection reads its outer
row therefore reconciles when that retained outer item slot changes. Mounting
registers the same update closure in every non-empty static domain. Owner
disposal removes cross-scope registrations. `keyed` validates all next keys
before updating records, moves retained node sequences into the new order, and
disposes missing records.

The generated item-scope identifier is not depth-indexed yet. A nested list may
derive its collection from the outer row, but its render body cannot directly
capture that outer row because the inner callback owns the nearest generated
item scope. The compiler diagnoses such a reference at its identifier span
instead of silently subscribing it to the wrong row.

Owned blocks carry their update ownership from their producer. Passing one into a child component transfers a mountable value, not a React element tree and not a second owner. A second mount throws `compiled block is already mounted`.

## Invariants

- A retained key preserves its record owner and exact DOM nodes across object replacement and reorder.
- Item-, tracked-index, component-, and mixed-dependency bindings observe their current values.
- A callback that does not declare an index parameter allocates no index cell or index invalidation path.
- Compiler-managed row cells and scopes share stateless callables; ordinary
  writes allocate no transition token or revision bookkeeping.
- Compiled inline row events remain delegated and owner-scoped without retaining
  a second reference to their item scope.
- A nested list collection observes replacement of its retained outer item and
  reconciles its own records without replacing the outer record.
- Key extraction receives raw collection values; identifier and destructured
  row rendering receives slots and compiler-owned property paths.
- An exact repeated key path allocates no item updater; changing the path's
  value changes record identity and therefore replaces the record owner.
- Duplicate keys fail before the current DOM is changed.
- Removing or changing a key disposes the old record exactly once.
- One owned block has one legal mount.
- Dependency registration is compiler-defined and static; no observer stack or runtime read tracking exists.

## Alternatives considered

- **Remount when object identity changes:** Simple, but defeats key semantics and loses focus, selection, local ownership, and surgical updates for immutable collection updates.
- **Runtime signals per item:** Would update correctly, but adds dynamic dependency discovery and a more general reactive runtime than Vidact needs. Static semantic analysis already knows the relevant item reads.
- **Diff arbitrary React element arrays:** Requires interpreting element objects and maintaining a runtime tree/diff contract, which conflicts with the React-to-direct-DOM goal.
- **Generate fully imperative row-specific updater functions immediately:** Likely produces the smallest mature ABI, but requires a larger JSX-to-DOM codegen step. Item scopes provide the same identity and static-update semantics while the current direct JSX runtime remains in place.
- **Retain a binding and skip equal values at runtime:** Preserves the same DOM
  result but keeps an evaluator, binding state, subscription, and updater record
  per row for a value that cannot change without replacing that row.

## Consequences

Immutable updates to list records are surgical for supported keyed callbacks,
and compiled arrays can be composed through prop boundaries. Explicit unkeyed
maps and direct `for...of` accumulators use the same record engine with position
keys; see [Compiler-owned iterative JSX](compiler-owned-iterative-jsx.md). Each
compiler-managed record pays for one compact scope, one read-only item cell,
and an index cell only when used; exact repeated key paths add no updater, while
mixed bindings register in two scopes. Scope methods, read-only getters, and
delegated event invocation are shared rather than allocated per record, while
transition-only cell fields remain lazy. Nested collections derived from an outer
item and direct/aliased/nested object leaf reads in map callback parameters are
supported, while direct outer-row captures remain diagnosed. Row-pattern
defaults/rest/arrays, broader imperative accumulator grammars, and arbitrary
external JSX arrays remain outside the accepted contract.

## Verification

- `packages/runtime/test/reactivity/compiled-dom.browser.test.ts` covers same-key object replacement, reorder, index updates, mixed component/item bindings, prop transport, and the single-mount rule.
- `packages/runtime/test/performance/runtime-budgets.browser.test.ts` checks that
  compiler-managed row callables and getters are shared, transition bookkeeping
  remains lazy, and compact inline events remain delegated.
- `tests/browser/corpus/apps/roster/RosterApp.browser.test.ts` proves same-key updates, reorder, append, and JSX-array prop transport through compiled TSX.
- `tests/browser/corpus/apps/control-flow/ControlFlowApp.browser.test.ts` proves
  a nested keyed list reconciles from a retained outer item while preserving
  both levels of DOM identity.
- `crates/vidact-compiler/tests/surgical_codegen.rs` checks separate item/component domains, invariant direct and destructured key reads, nested key-context restoration, structural branches, raw key selectors, and generated callback shape.
- `examples/todomvc/src/TodoApp.browser.test.ts` verifies a changed todo retains its exact `li` while rows are passed through `TodoList` as a prop.
- Run `cargo test --workspace`, `pnpm test:runtime`, `pnpm test:browser`, `pnpm test:examples`, and `pnpm typecheck`.
