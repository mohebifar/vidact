---
title: Transactional Publication and Exception Boundary
status: accepted-partial
date: 2026-08-22
---

# Transactional Publication and Exception Boundary

## Decision

A compiled source update separates computation from live DOM publication.
`drainFlushes` owns one publication queue across every scope reached by the
source transaction. Derived regions and binding evaluators run first. Scalar
text and host prop/event operations then commit in deterministic updater order.
If computation fails, queued operations abort without touching live DOM. If a
host setter fails during commit, applied operations run their captured inverse
in reverse order and the original error is rethrown.

The source slot write is not rolled back. A later update recomputes from the
current source value, matching the source/publication split in KTD8.

Native `try`/`catch` regions supported by the pinned Rust React Compiler lower
as structured Oxc statements inside derived updaters. Catch bindings remain
lexically local, and only the handled derived value reaches the publication
queue.

## Current exception-analysis boundary

The pinned Rust React Compiler rejects two JavaScript forms before Vidact's
owned analysis seam is produced:

- every `TryStatement` with a `finally` clause;
- an explicit `throw` lexically inside a `try` body.

These are upstream `BuildHIR` Todo diagnostics, not Vidact DOM-policy
diagnostics. Vidact must not reconstruct their completion graph from source
text while React Compiler remains the authority for CFG, SSA, and completion
edges. The compatibility corpus therefore records both forms as rejected until
the owned Oxc patch can export a correct upstream-shaped analysis.

## Atomicity still required before U10 closes

The publication queue currently covers scalar binding and host prop/event
writes. Existing range staging still protects construction failures, duplicate
keys, and new keyed records. Full U10 closure additionally requires publication
operations and inverses for retained-list item writes, list moves/removals,
branch/dispatcher replacement, ref attachment, and owner finalization. Those
operations must commit only after all reached computations succeed.

## Evidence

- `packages/runtime/test/lifecycle/failure-atomicity.browser.test.ts`
- `crates/vidact-compiler/tests/surgical_codegen.rs`
- `crates/vidact-compiler/tests/react_compiler_control_flow.rs`
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/synchronous-try.tsx`
- `crates/vidact-compiler/tests/fixtures/compatibility/rejected/synchronous-finally.tsx`
- `crates/vidact-compiler/tests/fixtures/compatibility/rejected/try-explicit-throw.tsx`
- `tests/browser/corpus/apps/synchronous-flow/SynchronousFlowApp.browser.test.ts`
