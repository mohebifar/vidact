# Compiler-injected DOM capability reachability

- Decision state: Accepted
- Decided: 2026-08-23
- Supersedes in part: [Versioned compiler targets and feature gates](versioned-compiler-targets-and-feature-gates.md)
- Extends: [Compact compiler/runtime ABI and measured bundle budgets](compact-compiler-runtime-abi.md)

## Context

Semantic feature flags isolated uncommon schedulers and protocols, but an
ordinary counter still reached controlled-form, object-style, and SVG/MathML
implementations through the shared direct-DOM property path. Those capabilities
are default-compatible syntax, so requiring author flags would be the wrong API;
their cost must instead follow the JSX that uses them.

## Decision

The surgical compiler scans the lowered JSX module and emits explicit,
idempotent activator imports for usage-local DOM families:

- intrinsic form controls, controlled form properties, `onChange`/`onInput`,
  and intrinsic spreads activate `@vidact/runtime/dom/forms`;
- intrinsic `style` properties and intrinsic spreads activate
  `@vidact/runtime/dom/styles`;
- SVG, MathML, and compiler-carried namespace properties activate
  `@vidact/runtime/dom/namespace`.

An intrinsic spread conservatively activates forms and styles because its keys
are runtime data. Component props do not activate DOM capabilities until they
reach an intrinsic JSX site. Server lowering owns its own serializer and does
not import browser activators.

The default browser runtime retains a small HTML intrinsic context and generic
property dispatcher. Capability modules install their specialized handlers into
that dispatcher. The compiler emits a named import plus an activation call, not
a side-effect-only import, so package `sideEffects: false` remains sound and
bundlers cannot discard a required installation.

## Compiler and runtime contract

- Activator identifiers are reserved generated bindings and activators are
  safe to call more than once across modules.
- Controlled-form event restoration reads the installed form capability through
  the generic property bridge; the event module no longer imports form code.
- HTML element creation and component namespace context stay in
  `dom/intrinsic`; only SVG/MathML creation and `foreignObject` transitions live
  in the namespace capability.
- Direct runtime browser tests activate all three capabilities in their test
  setup. React-shaped applications receive activation from compiler output.
- A missing style activation fails loudly instead of serializing an object as a
  meaningless attribute.

## Invariants

- A counter with only an HTML button and click handler renders no bytes from
  form, style, SVG/MathML namespace, raw-HTML, keyed-list, metadata, profiling,
  or ref modules.
- A module using a capability retains both its activator and implementation.
- Dynamic intrinsic spreads never silently lose form or style semantics.
- Client and hydrate targets make the same capability decision from source.
- Capability extraction does not change DOM identity, rollback, controlled
  restoration, style deletion, or namespace behavior.

## Alternatives considered

- **Compiler flags for forms, styles, and SVG:** rejected because these are
  ordinary default React authoring features, not optional semantic modes.
- **One full DOM activator:** simpler, but any used DOM specialization would
  pull every other specialization into the chunk.
- **Side-effect-only imports:** smaller generated syntax, but unsound with the
  package's side-effect declaration and aggressive tree shaking.
- **Runtime tag/prop dynamic imports:** asynchronous capability loading would
  make synchronous DOM construction observable and failure-prone.

## Consequences

Generated modules contain a few extra imports only when their JSX needs them.
The generic bridge and HTML intrinsic context remain default cost. New
usage-local DOM families must add a detector, isolated activator, positive
behavior coverage, and negative/positive rendered-module size gates.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs`
- `packages/runtime/test/setup-browser.ts`
- `tests/runtime-size/fixtures/dom-form.tsx`
- `tests/runtime-size/fixtures/dom-style.tsx`
- `tests/runtime-size/fixtures/dom-namespace.tsx`
- `tests/runtime-size/measure.mjs`
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/runtime test`
- `pnpm size`
