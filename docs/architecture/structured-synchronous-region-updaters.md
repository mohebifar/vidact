# Structured synchronous region updaters

- Decision state: Accepted
- Decided: 2026-08-22

## Context

Switch fallthrough, loops, labels, `break`, and `continue` encode evaluation and
completion order that should remain JavaScript. Flattening them into ad hoc
conditional expressions is error-prone; interpreting React Compiler CFG blocks
in the browser would add a large runtime and duplicate the language engine.

The phi-derived updater contract already identifies a live derived target and
its static input sources. What it lacked was a code shape for computations that
cannot be represented by one expression.

## Decision

Vidact records which structured terminal families React Compiler retained in
the owned CFG: `switch`, `for`, `for...of`, `for...in`, `while`, `do...while`,
labels, and `try`. This classification is stable Vidact IR; individual HIR
blocks and completion objects do not cross into codegen or runtime.

For a React-Compiler-live phi target, surgical codegen may select one top-level
structured Oxc statement that references the target and whose terminal family
is present in that IR. The current accepted region owns one derived output. Its
generated updater first resets that output to the cloned declaration initializer
(`undefined` when absent), then executes a semantic-ID-preserving clone of the
original statement. State/prop reads are rewritten to slots after cloning.

This keeps native syntax—including switch fallthrough, loop headers, labeled
breaks, and continue targets—in the generated JavaScript. React Compiler facts
authorize the region and provide def-use dependencies; Oxc semantic reads add
direct header/test sources. The browser receives only an ordinary updater
closure with source masks and a write mask.

Non-rendering `if` and `switch` statements no longer enter render-flow
normalization merely because they occur before the final JSX return. Only
statements containing a component return are render alternatives; computation
regions remain available to reactive-flow lowering.

## Current accepted subset

- One live derived output per structured region.
- `switch` with native fallthrough/default/break behavior.
- `for`, `for...of`, `for...in`, `while`, and `do...while`.
- Labeled loop statements plus `break` and `continue`.
- Local assignment/update and block-local loop variables.
- A declaration initializer that can be replayed as the region reset.

Multiple reactive outputs from one region, JSX accumulation, iterator-owned
arrays, and `try` publication semantics remain U9/U10 work. Render returns from
inside these regions also remain rejected until their owned-result semantics are
defined.

## Invariants

- React Compiler remains the authority that a structured terminal and live phi
  exist; AST shape alone cannot enable a region.
- Generated code preserves Oxc AST nodes and JavaScript completion syntax; it
  never serializes source strings or block enums.
- Loop-carried self versions do not become a false updater self-cycle because
  the region resets its output before execution.
- Nested callback/event-handler loops are never selected as component updater
  regions.
- Direct prop/global/captured writes continue to fail through destructive render
  diagnostics before codegen.
- No CFG interpreter, completion runtime, Virtual DOM, or component replay is
  added to the browser package.

## Alternatives considered

- **Lower every terminal to runtime block dispatch:** mechanically mirrors the
  CFG but ships a JavaScript interpreter and completion protocol.
- **Rewrite loops as array combinators:** changes sparse arrays, iterator
  closing, break/continue, labels, and evaluation order.
- **Generate source strings:** loses semantic identity, codegen guarantees, and
  safe composition with later rewrites.
- **Reject all structured regions:** simpler but excludes ordinary synchronous
  render calculations despite React Compiler already validating them.

## Consequences

Vidact now accepts a practical synchronous calculation subset with no new
runtime helper or bundle cost. Expanding beyond one output requires grouping
writes atomically rather than cloning the same region into independent updaters.
JSX-producing loops additionally require the explicit keyed/indexed ownership
contract in U9.

## Verification

- `crates/vidact-compiler/tests/react_compiler_control_flow.rs` proves upstream
  switch/loop/goto terminal capture.
- `crates/vidact-compiler/tests/surgical_codegen.rs` proves generated switch
  fallthrough and loop syntax, resets, and slot rewriting.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/synchronous-control-flow.tsx`
  records the accepted compiler subset.
- `tests/browser/corpus/apps/synchronous-flow/` proves all supported loop forms,
  labeled break/continue, switch fallthrough, stable DOM identity, exact
  mutation envelopes, and no-op writes through the Vite compiler path.
