# Render-flow normalization and identity

- Decision state: Accepted
- Decided: 2026-08-22

## Context

React Compiler already supplies typed CFG blocks, return operands, successors,
and exact source spans, but those generic facts do not say which render
alternatives occupy the same React position or whether their DOM/component
identity may be retained. Vidact previously rejected a component as soon as its
CFG contained more than one explicit return.

Source text is not a safe substitute for the CFG: nested callback returns,
comments, strings, and shadowed identifiers must not become component render
paths. React Compiler also must not acquire Vidact-specific DOM concepts.

## Decision

Vidact lowers component-level return structure into an owned
`RenderFlowGraph`. The graph is built from the parsed Oxc AST, but every return
leaf is first required to match React Compiler's exact explicit-return spans.
The graph retains source spans for predicates and values and stores alternatives
as node IDs, so a shared continuation remains a DAG rather than being copied
into every complete path.

The current normalizer represents early `if`/`else` returns, returned
ternaries, `&&`, `||`, `??`, and terminal switch cases. Logical nodes retain the
left expression as the value-producing branch; they do not collapse all three
operators into Boolean selection. Switch fallthrough, render returns inside
loops or labels, and exception regions remain deferred to structured-region
lowering.

Each render value also carries a recursively classified identity: host type,
component type, fragment, array, scalar, empty, or dynamic; plus absent, static,
or dynamic key identity. `align_render_identities` is the single compiler rule
for comparing alternatives:

- equal static type and key preserve the position;
- changed static type or key replaces it;
- dynamic type or key requires the narrow runtime dispatcher;
- preserved host, fragment, and array positions align children by index;
- preserved component identity does not recursively claim ownership of its
  children prop.

Surgical codegen now consumes these facts through one component-result exit.
Aligned static identities become persistent host/component slots, divergent
alternatives become owned choices, and dynamic keys become narrow identity
dispatchers. The runtime and publication details are recorded in
[Aligned render slots and identity dispatch](aligned-render-slots-and-identity-dispatch.md).

## Invariants

- Every component render return in the AST has one matching React Compiler CFG
  return span before normalization succeeds.
- Nested function and callback returns never enter the component graph.
- Unreachable normalization scaffolding is removed and every stored node is
  reachable from the graph entry.
- Logical alternatives preserve JavaScript operand-value semantics.
- Identity alignment never guesses across a dynamic type or key.
- Oxc's React Compiler snapshot remains DOM-agnostic; render identity belongs
  to Vidact-owned facts and IR.

## Alternatives considered

- **Rewrite each return independently:** easy to emit, but duplicates shared
  control flow and cannot establish one component range or consistent identity.
- **Infer paths from source strings:** loses semantic identity and admits
  callback or textual lookalikes.
- **Put DOM identity into the Oxc patch:** would make upstream synchronization
  harder and mix Vidact runtime policy into generic React analysis.
- **Enumerate complete render paths:** simple for tiny examples, but grows
  combinatorially for independent nested decisions.

## Consequences

The compiler can inspect and test render selection independently of runtime
publication while using the graph directly for executable control-flow
codegen. Early returns and the supported structural operators are now accepted
only where the compiled browser corpus proves their identity and mutation
contracts. Fallthrough and synchronous regions remain deferred.

## Verification

- `crates/vidact-compiler/tests/render_flow_ir.rs` covers nested early returns,
  shared continuations, logical value semantics, static and dynamic identity,
  keys, and terminal switches with fallthrough rejection.
- `crates/vidact-compiler/tests/oxc_react_adapter.rs` proves multiple exact CFG
  return sites lower into stable render-flow facts.
- `crates/vidact-compiler/tests/surgical_codegen.rs`, the compatibility corpus,
  and `tests/browser/corpus/apps/control-flow/` prove executable control-flow
  codegen and fail-closed boundaries.
- Run `cargo test -p vidact-compiler` and
  `cargo clippy -p vidact-compiler --tests -- -D warnings`.
