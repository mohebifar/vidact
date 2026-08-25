# Vidact

Vidact is an experimental React-to-Vanilla compiler: author components with a
React-compatible model, then compile them into direct DOM operations and a tiny
static updater runtime. There is no Virtual DOM and no runtime dependency
tracking.

This branch is a from-scratch Rust rebuild with client, hydration, and server
targets. The default contract covers modern function components, fine-grained
state and props, lifecycle hooks, context, external stores, refs, portals,
errors, forms, namespaces, and owned list ranges. Cross-cutting async,
concurrent, Actions, retained-UI, profiling, raw-HTML, and framework protocols
are explicit compiler features.

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
- `crates/vidact-node`: narrow Node-API adapter over the Rust compiler
- `packages/compiler`: stable JavaScript API, TypeScript declarations, and CLI
- `packages/runtime`: tree-shakeable scheduler, state slots, and keyed arrays
- `packages/vite-plugin`: native compilation and OXC JSX-lowering Vite adapter
- `tests/browser`: compiled Vitest Browser corpora running in Chromium, Firefox, and WebKit
- `examples/todomvc`: runnable array-state TodoMVC without a Virtual DOM
- `docs/architecture`: durable architecture decisions and upstream constraints

## Development

Requirements: Rust 1.96, Node 24+, pnpm 10, and Playwright's Chromium, Firefox,
and WebKit installs.

```sh
scripts/prepare-oxc.sh
pnpm install
pnpm typecheck
cargo test --workspace
pnpm test:browser
```

`pnpm check` runs lint/format/type gates, Rust and cross-browser suites, package
and example verification, production size reachability, and compiler/runtime
performance and retention budgets.
Every pull request needs a changeset file. Run `pnpm changeset` for a published
package change, or `pnpm changeset --empty` for repository-only work. Merged
changesets feed the automated coordinated Version Packages pull request.
The prepare script initializes the pinned Oxc submodule and applies Vidact's
checked-in React Compiler patch. Maintainers editing that patch install the
pinned tool with `go install github.com/microsoft/go-infra/cmd/git-go-patch@v0.0.16`;
ordinary builds do not require Go.

Run the first example from the repository root:

```sh
pnpm dev:todomvc
```

Vite sends every TSX module through `@vidact/compiler` before OXC lowers JSX
through `@vidact/runtime/jsx-runtime`. For the supported `useState` subset, Rust rewrites
state reads and writes by semantic identity, removes the lowered React state
import, and emits static bindings before OXC prints and lowers the module.
`mountCompiled` is the only public root renderer; there is no uncompiled
component replay or runtime `useState` fallback. Components construct their DOM
once. State writes run only compiler-selected derivations, DOM bindings,
conditional ranges, and keyed-list ranges; they do not rerun the component or
diff a tree.

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
- Compiler-carried host context constructs HTML, SVG, and MathML directly,
  including component boundaries and SVG `foreignObject` HTML islands.
- Retained elements receive deletion-aware style, attribute, capture-listener,
  and controlled-form updates without remounting.
- Keyed arrays reuse, move, insert, remove, and dispose DOM records.
- Multi-node array records remain contiguous.
- Duplicate keys fail before mutating the current DOM ordering.
- Disposed component scopes ignore later invalidations.
- Non-stabilizing updater feedback fails loudly instead of blocking the browser forever.

The compiler parses once, preserves source expressions as OXC AST, lowers React
Compiler control-flow facts into Vidact's owned-range IR, and composes source
maps back to original TSX. The Vite integration fingerprints target, features,
environment, compiler artifact, and compiler/runtime protocols. It also
automatically compiles reachable package entries whose owning metadata declares
React, including supported minified automatic/classic JSX output, while failing
closed when React import provenance has been erased. Dependency capsules retain
published-source maps and never fall back to a React runtime. Production
packages contain built ESM, declarations, maps, isolated entry points, and
clean-install gates.

See [the React compatibility matrix](docs/reference/react-compatibility.md),
[the React migration guide](docs/migration/from-react.md),
[release policy](docs/release-policy.md), and
[architecture decisions](docs/architecture/README.md) for the supported and
intentionally different contracts.
