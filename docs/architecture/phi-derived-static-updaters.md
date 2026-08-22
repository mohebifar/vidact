# Phi-derived static updaters

- Decision state: Accepted
- Decided: 2026-08-22

## Context

A local assigned from different render branches is neither an independent state
slot nor an expression that can be evaluated once at mount. Its selected value
must update when the predicate or any incoming value changes, and downstream
DOM/component consumers must observe that update after the join. Replaying the
component body or tracking reads at runtime would abandon Vidact's static
updater model.

The owned React Compiler snapshot now supplies the authoritative live phi,
declaration identity, incoming SSA values, predecessors, and def-use reads. It
does not supply a stable JavaScript AST for re-emitting the computation, while
Vidact's parsed Oxc AST does.

## Decision

A branch-derived local becomes a Vidact `Derived` source only when React
Compiler retains a live phi for its declaration. Phi locals seed source
reachability because JSX component callee positions are not ordinary expression
reads in every upstream pass. Shadowed locals remain separate through semantic
`SymbolId` and React declaration identity.

The first executable region form is a side-effect-free top-level `if`/`else`
whose branches contain exactly one simple assignment to the phi local. Nested
`else if` regions are represented recursively. Vidact clones the Oxc test and
right-hand-side expressions into one conditional expression, but accepts that
clone only because the React Compiler phi proves the join. Arbitrary statements,
compound assignments, keyed-item dependencies, missing alternatives, and
side-effectful regions remain deferred to structured-region lowering.

The generated derived updater:

- reads React Compiler def-use sources for incoming values;
- adds direct predicate sources resolved by Oxc semantic identity;
- writes the compiler-assigned phi-derived source;
- runs in the existing topologically ordered component scope; and
- leaves downstream equality and ownership checks to compiled bindings, prop
  slots, keyed records, and identity dispatch.

The original structured `if` executes once during component construction to
initialize the local. Later invalidations run only the cloned join computation;
the component body is never replayed. An inactive input may cause that guarded
computation to run, but assigning the same selected object/value makes binding
and prop `Object.is` guards emit no DOM mutation or subtree replacement.

A phi-derived component callee is a plain local value, so its root JSX position
can use the existing type/key dispatcher. State- or prop-slot-valued JSX callees
remain rejected until callable slot lowering dereferences the callee at both the
identity and invocation sites.

## Invariants

- No local becomes reactive from AST shape alone; a live React Compiler phi is
  mandatory.
- Updater reads include both incoming value dependencies and predicate sources.
- Compiler source/declaration identities, not identifier spelling, connect SSA,
  Oxc bindings, updater masks, and JSX consumers.
- An inactive branch update cannot mutate DOM, change keyed identity, or remount
  a selected component.
- One compiled event batch exposes one final selected snapshot downstream.
- The runtime receives source masks and closures, never phi nodes, CFG blocks,
  element descriptors, or a component replay function.

## Alternatives considered

- **Replay the component body:** naturally re-evaluates JavaScript but recreates
  render-phase effects, allocation, hook ordering, and runtime scheduling work.
- **Runtime signals/dependency discovery:** handles dynamic reads broadly but
  replaces the compiler-owned graph with subscriptions and tracking stacks.
- **Treat every branch input as a DOM dependency:** can refresh text but loses a
  stable selected object/array source and cannot order downstream consumers.
- **Lower arbitrary branch statements immediately:** broadens syntax before
  completion order and publication atomicity are established.

## Consequences

Branch-derived scalars, objects, arrays consumed by existing keyed maps, and
root component types now update surgically through the same static scheduler.
The accepted syntax is intentionally narrower than all JavaScript control flow;
U8 expands structured synchronous regions without changing this updater/runtime
contract.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` proves phi-derived updater
  masks/order, redundant aligned-expression elimination, and root component-type
  dispatch.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/branch-derived-values.tsx`
  makes the supported form part of the compiler contract.
- `tests/browser/corpus/apps/derived-control-flow/` proves inactive zero-mutation,
  active text/attribute/keyed-row updates, retained row identity, batched joins,
  repeated branch changes, and dynamic component type replacement in Chromium.
- Run `cargo test -p vidact-compiler`, `pnpm test:browser`, and
  `pnpm --filter @vidact/browser-corpus typecheck`.
