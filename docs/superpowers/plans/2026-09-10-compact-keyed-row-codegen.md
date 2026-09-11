# Compact Keyed-Row Code Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove per-row evaluator and key-forwarding click closures from compiler-proven keyed rows while preserving immutable updates and surgical DOM identity.

**Architecture:** Add two narrow compiler/runtime ABI helpers. Direct item-property bindings use a shared tuple evaluator, while exact invariant-key click forwarding uses a compact delegated tuple and shared invocation entrypoint. Existing binding and event lowering remains the fallback.

**Tech Stack:** Rust/OXC compiler lowering, TypeScript DOM runtime, Vitest browser tests, js-framework-benchmark.

**Spec:** `docs/superpowers/specs/2026-09-10-compact-keyed-row-codegen-design.md`

## Global Constraints

- Preserve keyed DOM identity and surgical updates.
- Preserve React-style immutable row replacement.
- Preserve public runtime APIs and published compiler compatibility.
- Add no dependencies.
- Do not modify pre-existing user changes under `examples/docs/src/routes/index.tsx` or `vendor/oxc`.
- Keep CPU and compressed-size regressions within five percent of the accepted baseline.

---

### Task 1: Compact direct item-property bindings

**Files:**
- Modify: `crates/vidact-compiler/tests/surgical_codegen.rs`
- Modify: `crates/vidact-compiler/src/surgical_codegen/mod.rs`
- Modify: `packages/runtime/src/compiled/core.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/performance/runtime-budgets.browser.test.ts`

**Interfaces:**
- Produces: `itemPropBinding<T, K extends keyof T>(slot, scope, reads, property): CompiledBinding<T[K]>`
- Consumes: compiler-managed keyed item slots and source masks.

- [ ] Add a compiler-output assertion that `{row.label}` emits
  `__vidactItemPropBinding(row, __vidactItemScope, 1, "label")` and no
  row-specific `() => row.get().label` evaluator.
- [ ] Run the surgical codegen test and confirm it fails because the helper is
  not emitted.
- [ ] Add a runtime allocation-shape test asserting two item-property bindings
  share the same evaluator function and observe slot replacement.
- [ ] Run the focused runtime test and confirm it fails because
  `itemPropBinding` is absent.
- [ ] Implement the extended binding tuple with one shared evaluator and export
  it from the runtime entrypoint.
- [ ] Teach JSX lowering to select the helper only for direct static,
  item-only property paths.
- [ ] Run the focused compiler and runtime tests and confirm they pass.

### Task 2: Compact invariant-key click forwarding

**Files:**
- Modify: `crates/vidact-compiler/tests/surgical_codegen.rs`
- Modify: `crates/vidact-compiler/src/surgical_codegen/mod.rs`
- Modify: `packages/runtime/src/compiled/core.ts`
- Modify: `packages/runtime/src/dom/events.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/performance/runtime-budgets.browser.test.ts`

**Interfaces:**
- Produces: `compiledKeyedEvent<Argument>(scope, handler, argument)`
- Produces: a private delegated tuple whose first slot is its shared invocation
  function.

- [ ] Add compiler-output tests for `() => remove(row.id)` and
  `() => setSelected(row.id)`, plus fallback cases that consume the event or
  pass a non-key field.
- [ ] Run the surgical codegen test and confirm the specialized assertions fail.
- [ ] Add runtime tests for shared dispatch, batching, owner error routing, and
  post-disposal suppression.
- [ ] Run the focused runtime test and confirm it fails because the compact
  event helper is absent.
- [ ] Extend delegated click storage and dispatch to accept the compact tuple.
- [ ] Implement `compiledKeyedEvent` with owner-scoped transactional dispatch.
- [ ] Teach event lowering to specialize only zero-argument, single-call,
  exact-invariant-key handlers.
- [ ] Run the focused compiler and runtime tests and confirm they pass.

### Task 3: End-to-end surgical behavior

**Files:**
- Modify: `tests/browser/corpus/apps/roster/RosterApp.browser.test.ts`
- Modify if needed: `tests/browser/corpus/apps/roster/RosterApp.tsx`

**Interfaces:**
- Consumes: compiler-generated compact item binding and keyed event ABI.
- Produces: browser evidence that immutable replacement mutates only the label
  text and preserves keyed row identity.

- [ ] Tighten the roster fixture so a browser-visible action exercises both
  specialized forms.
- [ ] Add or update the MutationObserver assertion for exactly one
  `characterData` mutation on the retained text node.
- [ ] Run the focused browser-corpus test and confirm the new compiler-output
  expectation fails before implementation, then passes after Tasks 1 and 2.
- [ ] Run browser-corpus typechecking and the full browser corpus.

### Task 4: Architecture, release note, and measured acceptance

**Files:**
- Modify: `docs/architecture/keyed-record-updaters-and-owned-blocks.md`
- Modify: `docs/architecture/README.md`
- Create: `.changeset/compact-keyed-row-codegen.md`
- Update ignored optimization log under
  `.context/compound-engineering/ce-optimize/vidact-keyed-memory-2/`

**Interfaces:**
- Consumes: final compiler/runtime behavior and benchmark evidence.
- Produces: accepted architecture contract and reproducible measurements.

- [ ] Update the accepted keyed-row ADR with the precise specialization and
  fallback boundaries.
- [ ] Add a patch changeset for compiler and runtime.
- [ ] Run formatting, linting, typechecking, compiler tests, runtime tests,
  browser corpus, and examples.
- [ ] Run the keyed benchmark correctness smoke test.
- [ ] Run three benchmark samples and compare median retained memory, CPU
  geomean, and compressed size with the accepted iteration-3 result.
- [ ] Keep and commit the implementation only if correctness passes, retained
  memory improves beyond noise, and CPU and compressed size stay within their
  five-percent envelopes.
