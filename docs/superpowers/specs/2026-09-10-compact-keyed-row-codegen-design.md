# Compact keyed-row code generation

- Decision state: Proposed
- Designed: 2026-09-10

## Context

Compiler-managed keyed rows preserve DOM identity across immutable object
replacement, but each row currently retains evaluator closures for direct item
property bindings and inline click closures that only forward the row's stable
key. In the js-framework-benchmark, 1,000 rows retain one direct
`row.label` evaluator and two key-forwarding click closures per row.

The accepted keyed-memory profile attributes material retained JavaScript to
generated row functions, bindings, inline events, and keyed scopes. DOM memory
and node count already match the required output, so the next reduction must
remove JavaScript objects without changing the rendered tree.

## Decision

The compiler specializes two patterns inside a keyed callback:

1. A direct, item-only static property read such as `row.label` becomes a
   compact item-property binding. The binding stores the row slot and property
   name and uses one shared evaluator function for every row.
2. A zero-argument `onClick` handler whose entire body calls a stable function
   with the exact invariant key, such as `() => remove(row.id)`, becomes a
   compact keyed-event tuple. The tuple retains the owner, target function, and
   key and uses one shared delegated invocation function.

Both representations remain private compiler/runtime ABI. Unsupported,
computed, mixed-dependency, multi-statement, event-argument, and non-key
expressions continue through `binding` and `compiledInlineEvent`.

## Compiler and runtime contract

The compiler imports `itemPropBinding` and `compiledKeyedEvent` only when
their generated identifiers occur in output.

`itemPropBinding(itemSlot, itemScope, itemMask, property)` returns a value
compatible with `CompiledBinding`. Its evaluator is stored at tuple position
1, so existing runtime reads invoke it with the binding tuple as `this`. It
subscribes only to the compiler-managed item scope and observes immutable
same-key row replacement.

`compiledKeyedEvent(componentScope, handler, key)` returns a compact delegated
event tuple. Delegated click dispatch invokes its shared entrypoint under the
component's logical owner and a compiled transaction. A disposed owner makes
the event inert.

The key argument is evaluated once when the keyed record mounts. This is valid
only for the same semantic path used as the record key; changing that path
replaces the keyed record.

## Invariants

- Same-key immutable row replacement updates the existing label text node.
- Keyed reorder preserves exact row and text-node identity.
- Specialized key-forwarding clicks batch state writes, route errors through
  the logical owner, and do nothing after disposal.
- Event handlers that use the event, contain additional statements, pass more
  than the invariant key, or read a non-key item field are not specialized.
- Direct item bindings with parent dependencies, computed properties, or
  non-item reads retain the generic binding path.
- Production payload growth stays within the existing five-percent benchmark
  ceiling.

## Consequences

The benchmark keeps React-style immutable data updates while retaining fewer
row-specific closures. The optimization is deliberately narrower than fully
imperative row code generation: it removes two proven allocation classes
without introducing a second DOM construction backend.

Additional row fusion remains possible later if measurement still shows
binding state as the dominant gap. This design does not add mutable object
tracking or runtime dependency discovery.

## Verification

- Compiler-output tests in `crates/vidact-compiler/tests/surgical_codegen.rs`
  prove specialization and fallback shapes.
- Runtime browser tests in
  `packages/runtime/test/performance/runtime-budgets.browser.test.ts` prove
  shared evaluators and compact event dispatch.
- The roster browser-corpus test proves one-character-data mutation and retained
  keyed node identity through immutable replacement.
- `scripts/evaluate-js-framework-benchmark.mjs` supplies correctness, keyed
  identity, retained memory, CPU, and compressed-size results.
