# Component spans and compatibility corpus

- Decision state: Accepted
- Decided: 2026-08-22
- Amended by: [Versioned compiler targets and feature gates](versioned-compiler-targets-and-feature-gates.md)

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
than identity. Supported named declarations, variable-bound arrows and function
expressions, and named default function declarations in a module are lowered in
source order. If any analyzed function cannot be classified or lowered, the
module fails instead of compiling a partial set.

`ComponentFacts`, `ComponentIr`, and diagnostics carry owned source spans. The
CLI renders a spanned diagnostic as `filename:line:column`; downstream
transform errors fall back to the component span until their individual AST
sites expose narrower spans.

Classifier and code-generation rejections carry `Diagnostic` values across
their internal boundary rather than collapsing to strings. Known unsupported
prop patterns, state declarations, JSX spreads and blocks, list keys, namespace
violations, component slots, and branch-varying refs select their originating
AST nodes. Component-span fallback is reserved for analysis invariants that do
not correspond to one source construct.

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
- Vidact joins a snapshot only to the named declaration or variable-bound arrow
  with the exact same span. It never falls back to name-only matching for a
  spanned analysis.
- Same-module components each receive independent source IDs and updater graphs.
- Surgical codegen transforms all accepted components and emits the shared
  runtime import once.
- Named block- and expression-bodied arrows plus function-expression components
  are lowered through the same parameter, body, and semantic-symbol contract as
  function declarations. Expression arrows normalize to an equivalent return
  body before semantic analysis while retaining their exact function span.
- Named default function declarations and default exports of a named component
  retain their source identity; the export spelling is not used as a join key.
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
- A known unsupported syntax family never substitutes the enclosing component
  span for its feature-site span.
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
Precise spans for internal analysis failures without a single source construct
remain follow-up work. Named and anonymous default function exports, both
ordinary arrow body forms, DOM-range lowering for multi-return control flow, and
original-TSX source maps are complete. Anonymous defaults receive a temporary,
span-derived analysis name that is removed before code generation. Adding a
compatibility fixture requires an explicit contract classification, which is
intentional maintenance overhead.

## Verification

- `crates/vidact-compiler/tests/oxc_react_adapter.rs`
- `crates/vidact-compiler/tests/react_compiler_control_flow.rs`
- `crates/vidact-compiler/tests/surgical_codegen.rs`
- `crates/vidact-compiler/tests/compatibility_corpus.rs`
- `crates/vidact-compiler/tests/vidactc.rs`
- `tests/browser/corpus/apps/multi-component/`
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/browser-corpus test`
