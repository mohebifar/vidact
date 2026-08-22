# React Compiler SSA join snapshot

- Decision state: Accepted
- Decided: 2026-08-22

## Context

Branch-dependent render values cannot be scheduled correctly from a union of
identifier reads. The compiler needs to know which SSA version reaches a join
from each predecessor, preserve declaration identity across those versions,
and distinguish sequential reassignment from a real branch merge. Rebuilding
that graph from Oxc AST control-flow syntax would duplicate work already owned
by React Compiler and would be especially fragile for nested branches, loops,
and exception edges.

React Compiler's HIR is arena-backed and intentionally unstable. Passing its
`BasicBlock`, `Phi`, `Place`, or identifier tables through Vidact would couple
the public compiler to upstream lifetimes and internal policy.

## Decision

The patched Oxc seam snapshots two additional generic facts from the optimized
HIR CFG, after SSA construction and redundant-phi elimination and before the
HIR becomes React Compiler's codegen-oriented reactive tree:

- every basic block's ordered direct predecessor IDs; and
- every live phi's target value plus ordered `(predecessor, value)` operands.

Values use the existing owned snapshot shape: SSA identifier ID, declaration
ID, optional source name/span, and no arena lifetime. The Oxc patch contains no
Vidact source IDs, updater concepts, JSX identity, DOM policy, or runtime code.

The adapter immediately lowers this snapshot into `ControlFlowFacts`. After
Vidact has finalized its public prop/state/derived source set, every captured
value is annotated by React Compiler declaration ID with an optional Vidact
`SourceId`. This join avoids spelling-based matches and therefore keeps
shadowed declarations separate.

`lower_reactive_flow` then creates a smaller Vidact-owned `ReactiveFlowGraph`
containing only predecessor and phi value flow. It validates that predecessor
blocks exist, each phi target is unique, every operand comes from a direct
predecessor, every predecessor contributes exactly once, and all operands share
the target declaration. Updater grouping and DOM publication remain later
Vidact lowering decisions.

The `vidactc analyze` JSON includes this graph as `reactiveFlow` so integration
drift and join ordering can be inspected without exposing React Compiler HIR.

## Invariants

- React Compiler remains the sole authority for CFG, SSA construction,
  redundant-phi elimination, predecessor identity, and declaration identity.
- The Oxc integration boundary contains owned scalar/string/vector facts only.
- Phi operand order is the compiler's stable predecessor order; Vidact does not
  reconstruct or alphabetize it.
- Shadowed bindings never join by name, and sequential reassignment never
  becomes a synthetic dependency cycle.
- A changed or missing upstream phi/predecessor shape fails stable lowering or
  conformance tests instead of silently inventing a default.
- The browser runtime never sees blocks, phis, or an SSA interpreter.

## Alternatives considered

- **Reconstruct joins from AST syntax:** avoids an upstream patch extension but
  duplicates control-flow/SSA semantics and breaks on non-trivial completion.
- **Expose arena-backed HIR:** gives complete information with little snapshot
  code but makes Vidact dependent on upstream internal types and lifetimes.
- **Union all branch dependencies:** can update visible output, but loses
  selected-predecessor identity, over-triggers inactive work, and cannot order
  sequential versions safely.
- **Capture phis before elimination:** preserves more raw detail but exports
  redundant nodes that React Compiler has already proven equivalent.

## Consequences

Phase 2 codegen can plan guarded join updaters without rerunning component
bodies or performing dependency discovery in the browser. The managed Oxc patch
grows by a small upstream-shaped data export and must be checked whenever Oxc
changes `BasicBlock`, `Phi`, or predecessor ordering.

## Verification

- `crates/vidact-compiler/tests/react_compiler_data_flow.rs` covers two-way and
  nested joins, predecessor/operand order, public-source annotation, sequential
  reassignment, and callback-local shadowing.
- `crates/vidact-compiler/tests/vidactc.rs` proves the stable debug protocol
  publishes the owned reactive-flow graph.
- `scripts/prepare-oxc.sh` proves the extracted patch applies cleanly to the
  pinned upstream gitlink.
- Run `cargo test -p vidact-compiler` and
  `cargo clippy -p vidact-compiler --tests -- -D warnings`.
