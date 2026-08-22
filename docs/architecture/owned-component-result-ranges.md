# Owned component result ranges

- Decision state: Accepted
- Decided: 2026-08-22
- Supersedes: the single-root component-result ABI in [Compiled component props, live ranges, and refs](compiled-component-props-live-ranges-and-refs.md)

## Context

Compiled components were identified by one returned DOM `Node` in a `WeakMap`.
That made one element and a `DocumentFragment` mountable, but the fragment was
only a transport: after insertion there was no stable object or boundary that
represented the component's complete live result. Empty and scalar component
results were not valid, disposal had to remember a snapshot of root nodes, and
mounting the same result twice was not a uniform runtime error.

Root control flow, fragments, and arrays need the same ownership contract as
Vidact's existing keyed, conditional, and binding ranges. React Compiler does
not define DOM boundaries, mount atomicity, ref publication, or cleanup
ownership, so this remains a Vidact runtime ABI decision.

## Decision

Every compiled component returns a `CompiledComponentResult`, not a DOM `Node`.
`compiledRoot` eagerly constructs the component exactly once into a detached,
comment-delimited range. The range accepts elements, fragments, sibling nodes,
scalars, empty values, compiled bindings, arrays, and nested owned blocks
without adding a wrapper element.

The component result is a single-mount `OwnedBlock`. Its private range record
owns the start marker, end marker, and compiled scope. Parent construction
adopts that scope at the block level, so disposing a parent branch, keyed item,
dynamic value, or component disposes every nested component range and stops its
updaters.

`mountCompiled` inserts the staged component range before the host's previous
children, commits queued refs, and removes the previous children only after the
new range succeeds. If insertion or ref attachment throws, it disposes the new
scope and range while retaining the previous host contents. Component cleanup
removes exactly the nodes between its live markers plus the markers themselves,
even when another cleanup throws.

The compiled JSX declaration therefore defines `JSX.Element` as
`CompiledComponentResult`. The legacy rerendering `mount` helper remains a
separate Node-returning compatibility path; it is not the compiled component
ABI.

## Compiler and runtime contract

- Generated component exits call `compiledRoot(scope, () => renderValue)` and
  return the resulting `CompiledComponentResult`.
- `compiledRoot` evaluates and materializes `renderValue` once under the
  component owner. A construction failure disposes the scope before the value
  can be published.
- Nested component values mount through the ordinary owned-block insertion
  path. Adoption records the child's scope cleanup in the active owner and does
  not introduce a runtime element tree.
- Refs remain queued during detached construction. A top-level mount, keyed
  insertion, conditional insertion, or binding replacement commits them only
  for the published nodes.
- A second call to a component result's `mount` method throws
  `compiled component is already mounted`.

This contract covers Vidact-compiled values only. It does not reconcile an
arbitrary React element object or an external `ReactElement[]`, and it does not
rerun a component body to discover a new result.

## Invariants

- One compiled component invocation creates one owner and one stable marker
  range, regardless of its visible root count.
- Component output adds no visible wrapper element.
- Component construction and render publication do not reinvoke the component
  body.
- Disposing the component removes exactly its owned nodes and stops every
  adopted scope, including nested component scopes.
- A render, insertion, or ref-attachment failure leaks no compiled scope or
  attached ref and leaves previously committed host children in place.
- A component result has exactly one legal mount.
- The runtime stores mountable values and range ownership, not a Virtual DOM or
  a dynamically discovered dependency graph.

## Alternatives considered

- **Keep one root `Node`:** smallest ABI, but cannot uniformly represent empty,
  scalar, or multi-root results and provides no stable live component boundary.
- **Use `DocumentFragment` as the component identity:** preserves the `Node`
  type during transport, but the fragment empties on insertion and cannot own
  or guard its live result.
- **Add a wrapper element:** gives one stable root but changes layout, CSS,
  accessibility, and React-visible DOM structure.
- **Return a React element tree and reconcile it:** supports broad dynamic
  shapes but introduces the runtime representation and diffing model Vidact is
  designed to avoid.

## Consequences

Root fragments, sibling arrays, scalars, and empty results now share one
production-oriented ownership and rollback path. Future render-flow lowering
can switch or align component results without inventing a second root ABI.

The cost is two comment nodes per compiled component and one small mountable
result object. Public compiled JSX types are intentionally no longer assignable
to `Node`; code that needs a concrete element must use a ref or query within the
mounted range.

## Verification

- `packages/runtime/test/reactivity/component-ranges.browser.test.ts` covers
  single and multi-root output, scalars, empty output, nested disposal,
  construction rollback, ref-publication rollback, and duplicate mounting.
- `packages/runtime/test/reactivity/compiled-dom.browser.test.ts` covers nested
  prop bridges, conditions, keyed output, bindings, refs, and disposal through
  the component-range ABI.
- `tests/browser/corpus/apps/` and `examples/todomvc/src/` compile React-shaped
  TSX through Vidact using `CompiledComponentResult` as `JSX.Element`.
- Run `pnpm typecheck`, `pnpm test:runtime`, `pnpm test:browser`,
  `pnpm test:examples`, `pnpm build:examples`, and `cargo test --workspace`.
