# Direct DOM-only construction

- Decision state: Accepted
- Decided: 2026-08-23
- Amends: [Single client compiler and runtime path](compiled-only-client-runtime.md)

## Context

Vidact evaluated a second construction backend that serialized static JSX into
`HTMLTemplateElement` markup, cloned template fragments, and located dynamic
targets through compiler-owned markers. It reduced output substantially for
large, almost entirely static trees. Application-shaped code with lists,
events, forms, components, and conditionals retained most runtime capabilities,
however, and repetitive direct-DOM construction compressed competitively.

Keeping both paths would also duplicate namespace, parser, custom-element,
form, raw-text, failure-atomicity, and test contracts. That production surface
is not justified by an optimization whose benefit depends strongly on source
distribution.

## Decision

Vidact has one intrinsic construction backend: direct DOM construction. Rust
surgical lowering leaves its compiler-owned JSX structure for Oxc to print
through `@vidact/runtime/jsx-runtime`. The runtime `jsx` helper calls `h`, which
constructs HTML, SVG, and MathML nodes once with DOM APIs and applies compiler
bindings directly to those retained nodes.

The compiler API, CLI, and Vite plugin expose no template-mode option. Generated
applications do not import an HTML-template runtime or assign compiler-generated
markup to `template.innerHTML`. The only supported HTML-string sink remains the
explicit, separately validated `dangerouslySetInnerHTML` contract.

Future static-tree work must improve this single backend or demonstrate an
application-level win large enough to justify reopening the decision. It must
not silently introduce a second semantic path per subtree.

## Invariants

- Every accepted intrinsic is created through the namespace-aware direct-DOM
  policy.
- There is no template-mode configuration, HTML-template code generator, marker
  ABI, or template-instantiation runtime.
- Components construct once; state writes run static updaters against retained
  nodes without a Virtual DOM or component replay.
- Browser-corpus tests exercise the same construction backend used by examples
  and production builds.
- Static optimization cannot bypass DOM property, event, form, style, ref,
  namespace, raw-HTML, ownership, or rollback semantics.

## Alternatives considered

- **Keep HTML templates as an opt-in backend:** preserves static-tree wins but
  retains a second compiler/runtime/test matrix and its parser-specific failure
  modes for a non-universal bundle improvement.
- **Choose HTML templates automatically per component:** makes semantics and
  bundle composition source-dependent and still requires both complete paths.
- **Emit imperative statements specialized per static node:** remains compatible
  with the direct-DOM contract and may be reconsidered as a code-generation
  optimization, but only with application-level size and runtime measurements.

## Consequences

The compiler and runtime return to one construction ABI. This removes template
parsing, clone traversal, marker discovery, parser-normalization diagnostics,
dual-mode configuration, and parity-suite duplication.

Very static applications give up the large compression win observed in the
discarded experiment. Vidact instead optimizes for ordinary interactive
applications and a smaller semantic maintenance surface.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` verifies generated JSX and
  direct-runtime imports.
- `packages/runtime/test/reactivity/direct-dom.browser.test.ts` covers direct
  construction infrastructure.
- `tests/browser/corpus/` runs React-shaped mini applications through the Vite
  plugin and asserts retained identity and bounded DOM mutations.
- Run `cargo test --workspace`, `pnpm typecheck`, `pnpm test:runtime`,
  `pnpm test:tools`, `pnpm test:browser`, and `pnpm test:examples`.
