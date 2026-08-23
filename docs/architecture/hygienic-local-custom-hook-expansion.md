# Hygienic local custom-hook expansion

- Decision state: Accepted
- Decided: 2026-08-23

## Context

Vidact constructs a component once and drives later work through compiler-owned
source masks. Replaying a runtime hook index would conflict with that model, but
ordinary React authoring depends on extracting related state, memoization, and
lifecycle resources into custom hooks. Those resources must still belong to the
calling component so branch, keyed-record, boundary, and root disposal clean
them up exactly once.

A custom hook parameter must also remain reactive. Capturing a caller prop or
state value only when the component is constructed would make effects and
derived values inside the hook stale.

## Decision

The client compiler expands module-local custom hooks before React Compiler
analysis. A custom hook is identified through semantic binding identity, not a
source-text match: a top-level `useX` function becomes expandable only when its
body transitively calls a supported React primitive. Each direct,
unconditional call in a component is replaced with a hygienically renamed copy
of the hook body.

React Compiler then analyzes the expanded component as one function. State,
memo, context, external-store, ID, ref, imperative-handle, and lifecycle calls
therefore use the caller's single compiled scope and logical owner. Rules-of-
Hooks validation sees the expanded primitive calls, so a conditional or nested
custom-hook call cannot hide invalid ordering.

Identifier and primitive-literal arguments are substituted into the expanded
body. Identifier substitution preserves the caller's semantic source identity,
which lets effects and derivations subscribe directly to reactive props or
state without an intermediate runtime hook dispatcher. Value-producing hook
returns lower through one hidden result binding followed by ordinary derived
bindings for identifier, array, object, and nested destructuring.

Every invocation receives unique generated names. Generated binding spans are
also normalized to distinct valid source offsets before semantic analysis so
repeated calls cannot alias React Compiler declaration identities. The compiler
reserves the `__vidactHook` prefix and reports a source-located conflict instead
of silently capturing user code.

The initial cross-module boundary remains explicit. Exported custom hooks are
diagnosed until dependency-source compilation supplies a versioned hook ABI;
silently leaving their React primitives for runtime execution would produce
stale values in construct-once components. Current expansion also requires
identifier parameters, direct top-level calls, side-effect-free supported
arguments, and one final top-level return.

## Invariants

- A custom hook invocation creates no renderer, hook index, or component rerun.
- All supported primitives expanded from a hook use the caller's scope and
  owner.
- Repeated and nested invocations have distinct state and lexical bindings.
- Reactive identifier arguments retain their caller source dependencies.
- Cleanup runs on dependency change, conditional removal, keyed removal, root
  disposal, and boundary-driven abandonment exactly as if the primitives were
  written directly in the component.
- Unsupported placement, export, parameter, argument, return, and result
  patterns fail at compile time with a source span.

## Alternatives considered

- **Runtime hook-index replay:** requires component reinvocation and returned
  tree reconciliation, both outside Vidact's identity.
- **Capture custom-hook arguments once:** keeps lowering small but makes prop and
  state arguments stale inside effects and memos.
- **Treat hook results as ordinary runtime values:** loses the source identity
  needed for surgical DOM subscriptions.
- **Inline by identifier spelling or source slicing:** breaks aliases, shadowing,
  repeated calls, and TypeScript syntax; semantic symbols and Oxc AST cloning
  provide the required identity and hygiene.
- **Pretend exported hooks work:** leaves erased state APIs or stale primitive
  snapshots at module boundaries. An explicit diagnostic is safer until the
  dependency ABI is implemented.

## Consequences

Application-local custom hooks compose supported primitives without adding
production runtime bytes. Their state, effects, and cleanup inherit every
existing owner and commit-phase guarantee. Expansion increases analyzed AST
size per invocation, so recursive hooks are rejected and a bounded expansion
pass prevents compiler hangs.

Reusable exported hooks remain part of the dependency-source/module-boundary
phase. When that ABI lands, this decision's semantic identity, owner, ordering,
and result-reactivity invariants still apply even if cross-module calls no
longer use literal body expansion.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` covers state/effect
  composition plus nested and repeated invocation hygiene.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/custom-hooks.tsx`
  records the supported authoring contract.
- `tests/browser/corpus/apps/custom-hooks/CustomHooksApp.browser.test.ts` proves
  reactive arguments, state and memo updates, mutation envelopes, cleanup on
  rerun, conditional removal, remount, and root disposal.
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/browser-corpus test`
