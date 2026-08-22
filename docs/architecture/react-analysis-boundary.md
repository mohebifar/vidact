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

## Semantic classification contract

React Compiler owns control-flow, SSA, alias, effect, and def-use analysis.
Vidact's smaller DOM classifier operates on the same parsed OXC program and
semantic scope graph:

- component parameters, state tuples, declarations, returns, JSX attributes,
  JSX children, and keyed maps are selected from AST nodes rather than source
  slices;
- named and namespace `useState` imports are resolved through OXC `SymbolId`s,
  so aliases work and a foreign function with the same spelling is rejected;
- React Compiler declaration IDs are joined to OXC bindings through captured
  source spans, then its def-use edges determine derived-source dependencies;
- reachable derived updaters are emitted in source declaration order; ordered
  sets are used for reachability only and never define execution order;
- JSX updater reads are collected from resolved identifier references, so
  comments, strings, shadowed bindings, and textual JSX lookalikes cannot create
  updater edges;
- JSX-producing `.map` calls enter the keyed-list IR only for `key={item}` or
  `key={item.property}`. Parent-dependent, computed, and index keys fail closed
  instead of falling through to a text updater or being reinterpreted by codegen.

The currently accepted component form remains one named function component per
module. Multiple components and other function forms fail closed until React
Compiler's owned snapshot exposes a stable function span for per-component
matching.

## Next integration step

The pinned adapter captures owned pre-codegen def-use and reactive-scope facts
and lowers them immediately into `ComponentFacts`. Vidact classification and
both executable emitters now use OXC AST and semantic identities; generated
output is printed with `oxc_codegen`. The next step is adding stable source-range
diagnostics, accepted/rejected/different fixture manifests, per-component span
analysis, and golden per-pass fixtures that detect drift whenever the vendored
React Compiler revision changes.

## Verification

- `crates/vidact-compiler/tests/oxc_react_adapter.rs` covers aliased and namespace
  React imports, foreign-hook rejection, shadowed bindings, source-text
  lookalikes, derived declaration order, and the normalized keyed-map subset.
- `crates/vidact-compiler/tests/surgical_codegen.rs` and
  `crates/vidact-compiler/tests/browser_codegen.rs` prove the executable paths
  transform aliased and namespace hooks using the same semantic contract;
  surgical codegen also proves unsupported key forms cannot bypass analysis.
- Run `cargo test -p vidact-compiler`.
