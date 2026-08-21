# Keyed record updaters and owned blocks

- Decision state: Accepted
- Decided: 2026-08-21

## Context

The first surgical runtime reused a keyed record only when both its key and item object were unchanged. Replacing `{ id: 1, title: "old" }` with `{ id: 1, title: "new" }` therefore disposed the record and mounted a new DOM subtree even though the stable key still identified the same row. It also represented keyed and conditional output as structural bindings without an explicit single-owner mount rule.

React Compiler analysis can identify component-level reactive inputs, but it does not decide list keys, DOM ranges, row ownership, or how a JSX expression maps to a concrete node property. Vidact needs those contracts in its own lowering and runtime.

## Decision

A compiled keyed record is identified only by its key. Each record owns its DOM nodes, cleanup owner, item updater scope, current-item slot, and current-index slot. When the same key receives a new object or position, `keyed` writes the new values into those slots and generated bindings update the retained DOM. A changed or removed key disposes the old record.

The OXC lowering uses semantic `SymbolId`s for keyed callback parameters. It rewrites item and index references to slot reads and classifies each JSX binding into a component-source mask, an item-source mask, or both. The runtime statically registers the emitted updater against those masks. It does not discover dependencies while evaluating the expression, so these slots are Vidact-style updaters rather than signals.

A keyed or conditional structural result is an owned block. The block may pass through props and be rendered as a child, including the compiled form of `<div>{props.arrayOfJsx}</div>`, but it may mount only once. This supports arrays produced by Vidact compilation; it does not make arbitrary external `ReactElement[]` values renderable.

## Compiler and runtime contract

The generated keyed callback receives `(itemSlot, indexSlot, itemScope)`. References to the source callback's item and index parameters become `.get()` calls. The key selector remains a raw-value callback so key calculation does not allocate slots before reconciliation.

`binding` and `when` accept their component scope/mask plus an optional item scope/mask. Mounting registers the same update closure in every non-empty static domain. Owner disposal removes cross-scope registrations. `keyed` validates all next keys before updating records, moves retained node sequences into the new order, and disposes missing records.

Owned blocks carry their update ownership from their producer. Passing one into a child component transfers a mountable value, not a React element tree and not a second owner. A second mount throws `compiled block is already mounted`.

## Invariants

- A retained key preserves its record owner and exact DOM nodes across object replacement and reorder.
- Item-, index-, component-, and mixed-dependency bindings observe their current values.
- Key extraction receives raw collection values; row rendering receives slots.
- Duplicate keys fail before the current DOM is changed.
- Removing or changing a key disposes the old record exactly once.
- One owned block has one legal mount.
- Dependency registration is compiler-defined and static; no observer stack or runtime read tracking exists.

## Alternatives considered

- **Remount when object identity changes:** Simple, but defeats key semantics and loses focus, selection, local ownership, and surgical updates for immutable collection updates.
- **Runtime signals per item:** Would update correctly, but adds dynamic dependency discovery and a more general reactive runtime than Vidact needs. Static semantic analysis already knows the relevant item reads.
- **Diff arbitrary React element arrays:** Requires interpreting element objects and maintaining a runtime tree/diff contract, which conflicts with the React-to-direct-DOM goal.
- **Generate fully imperative row-specific updater functions immediately:** Likely produces the smallest mature ABI, but requires a larger JSX-to-DOM codegen step. Item scopes provide the same identity and static-update semantics while the current direct JSX runtime remains in place.

## Consequences

Immutable updates to list records are now surgical for supported keyed callbacks, and compiled arrays can be composed through prop boundaries. Each mounted keyed record pays for a small scope and two state slots, and mixed bindings register in two scopes. Destructured callback parameters, nested keyed collections derived from an outer item, unkeyed reconciliation, and arbitrary external JSX arrays remain unsupported and should fail or remain outside the public contract until separately designed.

## Verification

- `tests/browser/corpus/reactivity/compiled-dom.browser.test.ts` covers same-key object replacement, reorder, index updates, mixed component/item bindings, prop transport, and the single-mount rule.
- `crates/vidact-compiler/tests/surgical_codegen.rs` checks separate item/component domains, slot reads, raw key selectors, and generated callback shape.
- `examples/todomvc/src/TodoApp.browser.test.ts` verifies a changed todo retains its exact `li` while rows are passed through `TodoList` as a prop.
- Run `cargo test --workspace`, `pnpm test:browser`, `pnpm test:examples`, and `pnpm typecheck`.
