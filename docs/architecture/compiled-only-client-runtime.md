# Single client compiler and runtime path

- Decision state: Accepted
- Decided: 2026-08-22
- Supersedes: the rerendering compatibility-runtime clause in [Owned component result ranges](owned-component-result-ranges.md)

## Context

The rebuild temporarily exposed two client execution models. `mountCompiled`
mounted compiler-produced `CompiledComponentResult` ranges whose component body
runs once and whose state writes drive static updaters. A separate `mount`
helper implemented hook-index state by rerunning an uncompiled component and
replacing its root node after each state write.

That compatibility path contradicted Vidact's central construct-once and
surgical-update contract. Keeping it public also made an accidental import
enough to opt out of compiler ownership, range disposal, static dependency
edges, and DOM identity guarantees.

The compiler package also retained `compile_spike_browser_module`, the bounded
alias-counter emitter that predated surgical code generation. It generated code
for the standalone `createUpdaterScope` runtime, while Vite and real TSX apps
already used `compile_surgical_module_with_ir` and `CompiledScope`. Keeping both
made two code generators and two updater schedulers look equally supported.

## Decision

The browser runtime has one component execution model: compiled components.
`mountCompiled` is the only public root-mount operation. The replaying `mount`
helper, its active-component singleton, hook cursor, stabilization loop, and
runtime `useState` implementation are removed.

The Rust package likewise has one executable browser compiler path: surgical
codegen. The spike emitter and standalone updater scheduler are removed. Their
low-level state and list machinery remains private where the compiled runtime
uses it, rather than appearing as alternative public application APIs.

`useState` remains accepted React-shaped source syntax. The Rust compiler lowers
each supported state declaration to `createCompiledState` and removes the
lowered React import. A state call left outside a compiled component declaration
is a compilation error; there is no runtime fallback.

`useRef` remains a deliberately small runtime primitive. Because a compiled
component executes once, creating one mutable cell during that execution makes
the cell stable for the component's lifetime without hook indexing or component
replay. The Vite plugin's virtual React module therefore exposes `useRef` only.

The `h` and JSX-runtime helpers remain direct DOM construction primitives. They
materialize the compiler's JSX output and nested compiled components; they are
not a public root renderer and never rerun a component to discover changes.

## Compiler and runtime contract

- Supported `useState` declarations become compiler-owned state slots and
  static updater references.
- Lowered named or namespace `useState` imports are removed from generated
  modules. Type-only state imports remain available to TypeScript. Any residual
  runtime state call or value reference fails compilation.
- A compiled component returns a single-mount `CompiledComponentResult` and is
  mounted with `mountCompiled`.
- Vite and direct compiler consumers use surgical compilation; there is no
  exported spike emitter or standalone static-updater scheduler.
- State writes invalidate the existing component scope. They cannot invoke the
  source component function or replace its root as a rendering strategy.
- `useRef` creates one ordinary mutable cell during one-time component
  execution; ref attachment and cleanup remain owned by compiled DOM ranges.

## Invariants

- `@vidact/runtime` does not export `mount` or `useState`.
- `@vidact/runtime` does not expose internal state-slot, list-owner, or obsolete
  standalone updater constructors as application APIs.
- There is no hook cursor, active replaying component, or rerender-pass loop in
  the client runtime.
- Compiled modules do not depend on a runtime `useState` export.
- `vidact-compiler` exposes no alternate bounded browser emitter.
- An unsupported state-call location fails closed instead of selecting another
  rendering model.
- Direct DOM construction and compiled component mounting do not create a
  Virtual DOM or general runtime reconciler.

## Alternatives considered

- **Keep the compatibility path under a legacy subpath:** still preserves a
  second semantic model and creates support pressure for behavior Vidact does
  not intend to ship.
- **Export a throwing runtime `useState` stub:** satisfies stale generated
  imports but leaves dead compatibility surface and defers the error until
  module execution. Compiler import cleanup gives an earlier, clearer boundary.
- **Rename `mountCompiled` to `mount`:** possible future API polish, but it would
  mix removal of the old semantics with an unrelated public rename. The current
  name makes the compiled-value requirement explicit.
- **Retain the spike as an example:** preserving executable obsolete code would
  keep its runtime ABI and tests alive. Historical rationale belongs in Git;
  current examples must exercise the production compiler path.

## Consequences

The runtime can no longer accidentally fall back to whole-component replay or
root replacement. Its public behavior now matches the compiler-owned ownership
and updater architecture.

Uncompiled React-shaped components cannot be executed by the runtime. Custom
hooks containing state calls remain unsupported until the compiler can lower
their ownership and data flow; they receive a compilation diagnostic rather
than compatibility behavior.

## Verification

- `packages/runtime/test/reactivity/public-surface.browser.test.ts` proves the
  legacy exports are absent and compiled refs remain available.
- `packages/runtime/test/reactivity/direct-dom.browser.test.ts` covers the
  retained direct DOM construction surface.
- `crates/vidact-compiler/tests/surgical_codegen.rs` proves lowered state imports
  disappear, type-only imports survive, live `useRef` imports remain, namespace
  state imports disappear, and residual state calls or references fail closed.
- `packages/vite-plugin/test/compiler-client.test.ts` verifies the compiler
  client receives state-slot output without a runtime `useState` dependency.
- Run `cargo test --workspace`, `pnpm typecheck`, `pnpm test:runtime`,
  `pnpm test:tools`, `pnpm test:browser`, `pnpm test:examples`, and
  `pnpm build:examples`.
