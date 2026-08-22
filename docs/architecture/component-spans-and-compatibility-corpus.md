# Component spans and compatibility corpus

- Decision state: Accepted
- Decided: 2026-08-22

## Context

React Compiler can analyze several functions in one module, but Vidact's first
adapter selected exactly one snapshot and then found the source component again
by name. Accepting more than one component under that contract could join one
function's def-use graph to another function's JSX and silently generate the
wrong updater graph. Unsupported syntax also produced messages without an
original-source location, and compatibility examples were spread across tests
without a machine-readable accepted/rejected/different contract.

## Decision

The owned React Compiler `FunctionAnalysis` snapshot carries the original
function byte span. Vidact keys classification and surgical lowering by that
span, with the component name used for diagnostics and public metadata rather
than identity. All supported named function declarations in a module are
lowered in source order. If any analyzed function cannot be classified or
lowered, the module fails instead of compiling a partial set.

`ComponentFacts`, `ComponentIr`, and diagnostics carry owned source spans. The
CLI renders a spanned diagnostic as `filename:line:column`; downstream
transform errors fall back to the component span until their individual AST
sites expose narrower spans.

React Compiler's owned CFG snapshot supplies exact return-terminal spans.
Vidact uses those facts to reject multiple render returns with
`UnsupportedControlFlow` at the first return site. Nested callback returns and
source-text lookalikes never enter the outer component CFG and therefore cannot
cause a false rejection.

The versioned manifest at
`crates/vidact-compiler/tests/fixtures/compatibility/manifest.json` classifies
every compiler compatibility fixture as:

- `accepted`: part of the compiled Vidact subset;
- `rejected`: must fail with the declared stable diagnostic code and a span
  selecting the declared source text;
- `different`: intentionally compiles with a documented observable divergence
  from React semantics.

Every fixture file must appear in the manifest. Accepted behavior that depends
on DOM identity or mutation granularity also needs a React-shaped browser mini
app compiled through the Vite plugin.

## Compiler and runtime contract

- Oxc supplies original byte spans; no arena-backed AST or HIR value crosses the
  analysis boundary.
- Vidact joins a snapshot only to the function declaration with the exact same
  span. It never falls back to name-only matching for a spanned analysis.
- Same-module components each receive independent source IDs and updater graphs.
- Surgical codegen transforms all accepted components and emits the shared
  runtime import once.
- Named arrow components are recognized by their span and source binding but
  currently reject with `UnsupportedComponentForm`; they are not silently
  mistaken for an anonymous or neighboring function.
- Parent-to-child compiled prop updates retain both component instances and
  mutate only the affected child binding.

## Invariants

- Component analysis and source classification agree on exact start and end
  offsets.
- Source order determines component order in analysis JSON and compilation
  metadata.
- Facts, sources, and updaters from two components never mix.
- A rejected manifest fixture always has the expected code and a valid original
  source span.
- No `.tsx` compatibility fixture exists outside the manifest.
- Browser evidence checks MutationObserver records and node identity separately.

## Alternatives considered

- **Match by component name:** simpler, but unsafe for anonymous forms, duplicate
  names in different scopes, and compiler-generated name hints.
- **Keep one component per file:** avoids the join but rejects ordinary module
  organization and postpones the same identity problem needed by hooks and
  nested functions.
- **Expose React Compiler HIR nodes directly:** retains identity but couples
  Vidact to arena lifetimes and unstable internal representations.
- **Use snapshots alone as the compatibility contract:** concise, but cannot
  distinguish accepted behavior, deliberate differences, and required
  rejections or prove surgical browser behavior.

## Consequences

Ordinary parent/child modules can now compile without splitting components into
files, and diagnostics can point back to original TSX. The Oxc patch now
includes an owned control-flow snapshot as well as the function span.
Arrow/default component lowering, DOM-range lowering for multi-return control
flow, precise spans for features other than returns, and composed original-TSX
source maps remain follow-up work. Adding a compatibility fixture requires an
explicit contract classification, which is intentional maintenance overhead.

## Verification

- `crates/vidact-compiler/tests/oxc_react_adapter.rs`
- `crates/vidact-compiler/tests/react_compiler_control_flow.rs`
- `crates/vidact-compiler/tests/surgical_codegen.rs`
- `crates/vidact-compiler/tests/compatibility_corpus.rs`
- `crates/vidact-compiler/tests/vidactc.rs`
- `tests/browser/corpus/apps/multi-component/`
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/browser-corpus test`
