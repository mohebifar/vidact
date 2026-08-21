# Vidact

Vidact is an experimental React-to-Vanilla compiler: author components with a
React-compatible model, then compile them into direct DOM operations and a tiny
static updater runtime. There is no Virtual DOM and no runtime dependency
tracking.

This orphan branch is a from-scratch Rust rebuild. It currently contains the
compiler-neutral updater IR, the runtime foundation, and executable browser
corpora. It does **not** compile TSX yet.

## Architecture

```text
React source
  -> React Compiler Rust analysis (AST, scope, HIR/CFG/SSA, dependencies)
  -> Vidact analysis adapter
  -> Vidact static updater IR
  -> Vanilla DOM codegen (next milestone)
  -> @vidact/runtime
```

React Compiler is an analysis dependency, not Vidact's renderer or code
generator. Its internal types terminate at a narrow adapter; the rest of Vidact
uses its own stable facts and IR.

At runtime, state slots contain ordinary values. A state write marks a
compiler-assigned source ID dirty. Updaters are emitted in execution order with
static read/write masks, so the browser does not discover dependencies or rerun
a component to diff trees.

See [the analysis boundary](docs/architecture/react-analysis-boundary.md) for
the rationale and integration constraints.

## Repository layout

- `crates/vidact-compiler`: compiler-neutral analysis facts and updater IR
- `packages/runtime`: tree-shakeable scheduler, state slots, and keyed arrays
- `tests/browser`: Vitest Browser corpora running in Chromium
- `docs/architecture`: durable architecture decisions and upstream constraints

## Development

Requirements: Rust 1.89, Node 24+, pnpm 10, and a Playwright Chromium install.

```sh
pnpm install
pnpm typecheck
cargo test --workspace
pnpm test:browser
```

`pnpm check` runs the typecheck and both Rust and browser test suites.

## Current contract

- Static updater order and read/write edges are preserved by the Rust IR.
- Updaters are topologically ordered; cycles and ambiguous writers fail before code generation.
- Source masks scale beyond one 32-bit word.
- Batches execute each affected updater once per flush.
- Keyed arrays reuse, move, insert, remove, and dispose DOM records.
- Multi-node array records remain contiguous.
- Duplicate keys fail before mutating the current DOM ordering.
- Disposed component scopes ignore later invalidations.
- Non-stabilizing updater feedback fails loudly instead of blocking the browser forever.

The next milestone is the pinned React Compiler adapter, followed by TSX-to-DOM
code generation and Vite integration. The project is not production-ready until
those paths, diagnostics, SSR/hydration policy, events, effects, and cross-browser
corpora are complete.
