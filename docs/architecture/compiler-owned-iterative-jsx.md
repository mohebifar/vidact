---
title: Compiler-Owned Iterative JSX
status: accepted
date: 2026-08-22
---

# Compiler-Owned Iterative JSX

## Decision

Vidact lowers supported JSX-producing maps and imperative `for...of`
accumulators directly to range-owned records. It does not create React element
descriptors and does not pass an arbitrary element tree to the browser runtime.

Two identity modes are explicit in generated code:

- JSX with `key={item}` or `key={item.property}` imports `keyed`. Records retain
  their owner, state slots, nodes, refs, and focus by primitive key.
- JSX without a key imports `indexed`. Records retain their owner by position;
  prepend and reorder operations deliberately shift new values through existing
  positional owners, matching React's unkeyed identity behavior.

An explicit key outside the normalized key grammar is a compiler error; it
never falls back to index identity. At runtime, keyed lists validate every key
before constructing or updating records. Keys must be strings, numbers, or
bigints and must be unique. Objects, symbols, booleans, nullish values, and
duplicates fail before publication.

## Imperative loop lowering

The initial production-safe imperative form is:

```tsx
const rows = []
for (const item of items) {
  rows.push(<Row key={item.id} item={item} />)
}
return <section>{rows}</section>
```

React Compiler supplies the loop CFG and semantic declaration/reference
identity. Vidact's DOM-specific iterative pass proves that the accumulator is a
fresh empty local, the iterable is a tracked expression, and the loop body is
one direct JSX `push`. It then removes the construction loop and emits the same
keyed or indexed item-slot factory used for `.map`. The item and index become
per-record state slots, so immutable replacement updates retained rows
surgically.

Loops with filtering, several pushes, nested collection production,
destructured items, or JSX selected by loop-local control flow remain outside
this initial factory grammar. They must not silently execute once during
component mount; future work should extend the compiler-owned factory IR while
preserving React Compiler completion edges.

## DOM movement

Keyed reordering uses the platform's state-preserving `moveBefore` operation
when an existing node is already under the list parent. The fallback uses
`insertBefore` and restores focus and text selection when the focused element
remains in the retained record. New records use ordinary insertion.

## Consequences

- Straight-line components do not import either list helper.
- Indexed support reuses the keyed record engine with numeric position keys, so
  ownership, disposal, multi-node rows, and item updater behavior stay unified.
- Compiler-owned keyed blocks continue to cross compiled prop boundaries as
  single-mount owned values; this does not add support for foreign
  `ReactElement[]` values.
- Iterative lowering is syntax-narrow by design, but every accepted shape has a
  static identity mode and never falls back to a general reconciler.

## Evidence

- `packages/runtime/test/arrays/keyed-arrays.browser.test.ts`
- `packages/runtime/test/arrays/indexed-arrays.browser.test.ts`
- `crates/vidact-compiler/tests/surgical_codegen.rs`
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/iterative-jsx-arrays.tsx`
- `tests/browser/corpus/apps/synchronous-flow/SynchronousFlowApp.browser.test.ts`
