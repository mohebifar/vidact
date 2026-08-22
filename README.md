# Vidact

Vidact is an experimental React-to-Vanilla compiler: author components with a
React-compatible model, then compile them into direct DOM operations and a tiny
static updater runtime. There is no Virtual DOM and no runtime dependency
tracking.

This orphan branch is a from-scratch Rust rebuild. It currently contains the
compiler-neutral updater IR, the runtime foundation, and executable browser
corpora. A surgical vertical slice now compiles the TodoMVC example into
one-time DOM construction, scalar bindings, conditional ranges, and keyed list
ranges. It is not a general TSX compiler yet.

## Architecture

```text
React source
  -> React Compiler Rust analysis (AST, scope, HIR/CFG/SSA, dependencies)
  -> Vidact analysis adapter
  -> Vidact static updater IR
  -> Vanilla DOM codegen
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
- `packages/vite-plugin`: Rust compilation and OXC JSX-lowering Vite adapter
- `tests/browser`: Vitest Browser corpora running in Chromium
- `examples/todomvc`: runnable array-state TodoMVC without a Virtual DOM
- `docs/architecture`: durable architecture decisions and upstream constraints

## Development

Requirements: Rust 1.96, Node 24+, pnpm 10, and a Playwright Chromium install.

```sh
scripts/prepare-oxc.sh
pnpm install
pnpm typecheck
cargo test --workspace
pnpm test:browser
```

`pnpm check` runs the typecheck and both Rust and browser test suites.
The prepare script initializes the pinned Oxc submodule and applies Vidact's
checked-in React Compiler patch. Maintainers editing that patch install the
pinned tool with `go install github.com/microsoft/go-infra/cmd/git-go-patch@v0.0.16`;
ordinary builds do not require Go.

Run the first example from the repository root:

```sh
pnpm dev:todomvc
```

Vite sends every TSX module to the Rust compiler before OXC lowers JSX through
`@vidact/runtime/jsx-runtime`. For the supported `useState` subset, Rust rewrites
state reads and writes by semantic identity and emits static bindings before
OXC prints and lowers the module. Components construct their DOM once. State
writes run only compiler-selected derivations, DOM bindings, conditional
ranges, and keyed-list ranges; they do not rerun the component or diff a tree.

## Current contract

- Static updater order and read/write edges are preserved by the Rust IR.
- Supported compiled components execute once and retain their root DOM identity.
- Scalar text and properties update through compiler-emitted bindings.
- Conditional blocks own comment-delimited DOM ranges and dispose nested bindings.
- Keyed arrays preserve unaffected records and reject duplicate keys before mutation.
- Updaters are topologically ordered; cycles and ambiguous writers fail before code generation.
- Source masks scale beyond one 32-bit word.
- Batches execute each affected updater once per flush.
- Compiler-wrapped DOM events batch their synchronous state writes.
- Keyed arrays reuse, move, insert, remove, and dispose DOM records.
- Multi-node array records remain contiguous.
- Duplicate keys fail before mutating the current DOM ordering.
- Disposed component scopes ignore later invalidations.
- Non-stabilizing updater feedback fails loudly instead of blocking the browser forever.

The pinned React Compiler adapter and a bounded TSX-to-DOM code generator are
now executable. The emitter parses once, preserves source expressions as OXC
AST, rewrites state references by semantic binding identity, builds the output
AST, and delegates printing to `oxc_codegen`. TodoMVC proves the full
TSX-to-browser path including array insertion, filtering, editing, removal, and
surgical DOM identity. Vidact-specific source and render classification now
uses OXC AST nodes and semantic binding identities; aliased and namespace React
state imports work, while foreign hook-shaped calls fail closed. The next
milestone is a source-located accepted/rejected compatibility corpus and
per-component span analysis. The project is not production-ready until effects,
complete component/DOM ownership semantics, original-TSX source maps,
SSR/hydration, and cross-browser gates exist.
