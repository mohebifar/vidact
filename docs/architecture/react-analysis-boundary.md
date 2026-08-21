# React analysis boundary

Status: accepted for the rebuild scaffold, 2026-08-21.

## Decision

Vidact will use the Rust React Compiler for language and data-flow analysis, but
will own the updater IR, Vanilla DOM code generation, and runtime.

The upstream Rust port was [merged into React on June 9,
2026](https://github.com/react/react/pull/36173). The port retains React
Compiler's HIR, control-flow graph, SSA, inference, validation, and reactive-scope
passes. Those are the difficult semantic layers we should reuse.

The upstream integration boundary is still described as a Rust representation
of Babel AST plus scope information in, and Rust Babel AST out. Its maintainers
also call out planned API changes. We therefore pin the evaluated React revision
in the root `Cargo.toml` and isolate all upstream types behind one adapter.

```text
                     upstream-owned
React AST + scope --------------------------+
                                            v
                                HIR -> CFG -> SSA -> inference
                                            |
                                            | extracted facts only
                                            v
                     Vidact-owned  ComponentFacts
                                            |
                                            v
                                      ComponentIr
                                            |
                              +-------------+-------------+
                              v                           v
                       DOM codegen                 diagnostics/source maps
                              |
                              v
                    static updater runtime
```

Vidact must not:

- fork JavaScript scope, closure, alias, or control-flow analysis;
- expose React Compiler HIR types from public Vidact crates;
- invoke React Compiler's memoization code generator;
- depend on React's runtime cache protocol;
- rediscover the dependency graph in the browser.

## Updaters, not signals

The runtime model is a production-strength continuation of the original Vidact
idea rather than a signal graph.

- A state slot is an ordinary value plus a compiler-assigned source mask.
- Reads are ordinary JavaScript reads and register no subscribers.
- A setter invalidates its source mask.
- Each generated updater declares static `reads` and optional derived `writes`.
- The compiler emits updaters in topological execution order.
- A component scope batches dirty masks and executes only intersecting updaters.

This resembles fine-grained reactive systems in update granularity, but the
dependency graph is a compile artifact. There are no signal objects, observers,
or runtime tracking stacks.

For common components a source mask is one number. Wider components use a
`Uint32Array`, preserving the compact common path without imposing a 32-source
correctness limit.

## Arrays

Array expressions become structural updaters in the Vidact IR. The first runtime
contract is keyed reconciliation over DOM ranges:

- keys are validated before mutation;
- retained records keep their DOM identity;
- records may own multiple contiguous nodes;
- reordered records move their existing nodes;
- removed records run disposal hooks;
- empty records receive a private anchor;
- list disposal removes anchors and all owned nodes.

Unkeyed lists may be added as an explicit index-based mode, but must never be an
implicit fallback for a keyed list with invalid keys.

## Bundle boundary

Compiler complexity remains in Rust/build tooling. The browser package contains
only source-mask operations, the static updater scope, state slots, and structural
DOM helpers. Each helper is exported as an ESM function and the runtime package
declares `sideEffects: false` so unused capabilities can be removed.

Bundle budgets will be enforced once code generation produces representative
artifacts; claiming a size before that would measure the scaffold rather than the
product.

## Next integration step

Create a dedicated adapter crate at the pinned upstream revision. It should run
only the upstream passes required to produce stable source, read/write, effect,
branch, and keyed-list facts, then immediately lower into `ComponentFacts`.
Golden per-pass fixtures should detect drift when updating the React revision.
