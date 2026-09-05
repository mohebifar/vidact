# Static updater ordering boundary

- Decision state: Accepted
- Decided: 2026-09-05

## Context

The compiler topologically orders every updater present in `ComponentIr`, but
the browser runtime can add owner-scoped capabilities after that sequence is
emitted. `createCompiledMemo`, effect and subscription bridges, and other
tree-shaken helpers use the same scope registration API as generated updaters.
A runtime-owned producer can therefore be registered after, or earlier than, a
generated consumer that depends on its published source.

Treating emitted array position as the complete execution contract would expose
stale values in these mixed graphs. Describing the runtime correction as
dependency discovery was also inaccurate: each edge is declared in a static
read or write source mask. The runtime never observes property access or records
subscriptions while user code executes.

## Decision

The compiler remains responsible for semantic dependency analysis and emits its
known updater graph in topological order. A compiled scope accepts additional
updaters only with explicit `reads` and optional `writes` masks. On the first
flush after construction or a registration change, the scope composes all active
declarations into one cached execution order.

Ordering builds a source-to-reader index, then creates only the writer-to-reader
edges named by matching source bits. Strongly connected components preserve
registration order among their members, while the component graph is executed
topologically. Adding or removing an updater invalidates the cached order; state
writes do not.

## Compiler and runtime contract

- `ComponentIr.updaters` is the compiler order for the statically known graph.
- `CompiledScope.add(reads, run, writes?)` declares all dependencies needed to
  compose a runtime-owned updater with that graph.
- A scope may reorder active updater registrations to place producers before
  consumers. It cannot infer an omitted mask from the updater callback.
- Edge construction scales with declared set bits and actual dependency edges,
  rather than comparing every writer with every reader.
- Cycles run in stable registration order. Further invalidations create another
  flush pass, bounded by the scope stabilization limit.

## Invariants

- An earlier-registered consumer observes a later-registered prerequisite in
  the same flush.
- A downstream updater runs after a dependency cycle has published its sources.
- Registration and owner disposal take effect on the next computed order.
- Unchanged topology reuses the cached order across writes.
- Runtime ordering never evaluates a dependency expression or observes a read.

## Alternatives considered

- **Use emitted position only:** fails when a tree-shaken runtime capability
  introduces a producer that the compiler sequence could not position.
- **Track reads while callbacks execute:** supports dynamic graphs but adds
  subscriptions and a tracking stack, contradicting Vidact's static dependency
  model.
- **Compare every writer and reader mask:** correct, but repeated registration
  churn made edge construction quadratic even for sparse graphs.
- **Generate a final order after all capabilities lower:** attractive for
  compiler-created helpers, but insufficient for owner-scoped registrations
  created during runtime construction and disposal.

## Consequences

The runtime retains a small graph-ordering implementation, including SCC
handling. Its input is bounded static metadata rather than observed application
behavior. Sparse large graphs and topology churn no longer pay for all possible
writer-reader pairs; dense dependency graphs still incur their actual edge cost.
The benchmark command reports 64, 256, and 1,024-updater samples plus repeated
registration/removal churn and enforces budgets for both paths.

## Verification

- `packages/runtime/test/reactivity/static-updaters.browser.test.ts` proves
  prerequisite ordering, cycles, order invalidation, memo publication, wide
  source masks, and the stabilization failure.
- `scripts/benchmark.mjs` measures increasing updater counts and 100 topology
  changes on a 256-updater graph.
- `pnpm --filter @vidact/runtime test`
- `pnpm size`
- `pnpm benchmark`
