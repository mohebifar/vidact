# Compiled component props, live ranges, and refs

- Decision state: Accepted
- Decided: 2026-08-21
- Component-result ABI superseded by: [Owned component result ranges](owned-component-result-ranges.md)

The prop-bridge, dynamic binding-range, and ref contracts in this decision
remain accepted. The former single-root component-result limitation was
superseded on 2026-08-22 by the owned component range ABI linked above.

## Context

Vidact already constructed supported components once, but component composition
did not have a reactive ABI. A parent could pass an owned keyed block through a
static child, while an ordinary prop such as `label={state}` was only a lexical
mount-time value. Removing a nested compiled component also removed its DOM
without necessarily disposing its scope.

Generic compiled child bindings were scalar text nodes. Arrays, DOM nodes, and
empty values were stringified or could not replace one another. Structural
blocks staged in a `DocumentFragment` also retained that temporary fragment as
their update parent after their markers moved into the live document. Host refs
were treated as ordinary properties rather than commit-phase resources.

React Compiler analysis supplies def-use facts and source identities. It does
not define any of these component, DOM-range, ownership, or ref semantics, so
they belong to Vidact's lowering and runtime ABI.

## Decision

Each direct destructured prop accepted by surgical lowering, including an
aliased local binding, becomes a child-local state slot with a compiler-assigned
source mask. A reactive value passed by the parent is a `CompiledBinding`
descriptor: it contains an evaluator, static read masks, and its originating
scopes. `createCompiledProp` evaluates that descriptor into the child slot and
subscribes a generated bridge updater. A static value initializes the same slot
without an upstream subscription.

The child owns removal of the bridge subscription. When `h` invokes a compiled
child, it adopts the child's compiled scope into the currently active parent,
branch, list-item, or dynamic-value owner. Removing that owner therefore
disposes the child scope, its prop bridges, its nested updaters, and its refs.
Component invocation also collects every scope created before a root is
returned; if construction throws, those scopes are disposed instead of waiting
for an adoption step that can no longer occur.

Compiled child values use comment-delimited ranges. A range can contain text,
DOM nodes, nested arrays, empty values, compiled bindings, and single-mount
owned blocks. Non-scalar replacements are built under a fresh owner and staged
before the old range is disposed. Keyed lists, conditions, and bindings resolve
their parent from their live boundary markers for each update; they never rely
on the `DocumentFragment` in which they may have been constructed.
Staging records original node positions and restores them in reverse order when
a later value fails, so validating a mixed array cannot steal nodes from the
previous committed range.

Host object refs and callback refs attach only after their element enters the
committed DOM range. Their clear or callback-cleanup operation belongs to the
same owner as the element. `useRef` is an ordinary stable cell in compiled
components because a supported component function executes once. A `ref`
destructured by a function component is an ordinary compiled prop, matching the
React 19 ref-as-prop authoring model; when forwarded to a host element, the
resolved ref value enters the same host ref commit lifecycle.

`useImperativeHandle` queues an owner resource during component construction.
After the component range enters its live parent, descendant host refs commit
in document order and the component end marker publishes the handle. The
callback cleanup or object-ref clear belongs to that component owner, so a
conditional removal, keyed-record removal, or root disposal clears the exposed
handle exactly once. The first accepted form has an omitted or empty dependency
list. Dependency-driven handle replacement remains fail-closed until lifecycle
dependency bindings share the compiler's static source-mask contract.

This is a Vidact compiled-value ABI, not arbitrary React element
reconciliation. Owned structural blocks still mount once. External
`ReactElement[]`, reactive imperative-handle dependencies, effects, portals,
Suspense, and SSR/hydration remain outside the accepted contract.

## Compiler and runtime contract

For a direct object-destructured parameter, the compiler emits:

```ts
prop = createCompiledProp(scope, sourceMask, prop, optionalDefaultFactory)
```

Every later semantic reference to that binding becomes `prop.get()`. Reads in
JSX are wrapped in `binding`; a parent-side reactive JSX prop is likewise passed
as a `CompiledBinding`, so the runtime bridge connects the parent source mask to
the child-local mask without dynamic dependency discovery. Default factories
apply when a reactive upstream value is `undefined`.

`CompiledScope.batch` participates in one runtime transaction queue. The scope
that started a flush runs all of its bridge updaters before queued child scopes
drain. Multiple prop slots changed by one parent batch therefore become one
child invalidation set, rather than a sequence of torn child snapshots.

Prop bridges use the slot's exact-value replacement entry point rather than its
React state updater entry point. Function-valued callbacks and component types
therefore remain values and are never invoked merely because an upstream binding
changed.

The current compiler accepts direct object destructuring and binds each public
property to its resolved local semantic symbol, so `{ value: displayed }`
updates `displayed` without reinvoking the component. It rejects rest props,
computed or nested patterns, reactive JSX spreads, and reactive local
derivations absent from its data-flow facts. These fail-closed checks prevent
known mount-time snapshots while the AST classifier and diagnostics are still
incomplete.

Each dynamic value range owns the resources created by its current non-scalar
value. Replacing the value disposes that owner and removes only the nodes between
the range markers. Scalar-to-scalar changes retain one text node. Array
normalization is recursive and treats `null`, `undefined`, and booleans as
empty. A keyed or conditional block embedded in an array keeps its own marker
range and ownership.

Refs are queued while elements are constructed, claimed by the active owner,
and committed after insertion. Callback-returned cleanup takes precedence over
a fallback `ref(null)` clear. Object refs clear only if they still point at the
element being disposed. A compiled ref binding stages its next attachment before
clearing the previous ref. A thrown attachment leaves the previous ref owned and
active; successful transitions retain the host element and transfer cleanup to
the next ref. Imperative handles use the same attachment primitive but commit
at their owning component's end marker, after descendant host refs and before a
future layout-effect phase.

## Invariants

- A reactive parent prop invalidates a child-local slot without reinvoking the
  child component.
- A retained state setter fails before evaluating its update after the owning
  component has been disposed; the dead slot cannot mutate silently.
- One parent batch that changes several props runs a dependent child updater
  once with the complete next prop set.
- A function-valued prop crosses the bridge by identity without being mistaken
  for a functional state update.
- Disposing a parent branch or keyed record stops all adopted child prop
  updates and runs nested cleanup once.
- A component that throws during construction leaves no created scope or prop
  bridge subscribed.
- A binding range may transition among scalar, empty, node, nested-array, and
  owned-block values without replacing surrounding siblings.
- Moving staged markers from a fragment into the document does not leave an
  updater targeting the fragment.
- A failed staged render leaves the previous committed range in place.
- An owned block still has exactly one legal mount.
- Refs attach after insertion and clear with their element owner; keyed moves do
  not reattach an unchanged element.
- A component `ref` prop reaches the child without `forwardRef`, attaches after
  host insertion, and clears when the child owner is disposed.
- An imperative handle with static lifetime is unavailable during construction,
  publishes after descendant host refs, updates state through stable setters,
  survives retained-owner movement, and clears on owner disposal.
- Prop and DOM subscriptions remain statically declared updaters, not runtime
  signals or observer-tracked dependencies.

## Alternatives considered

- **Rerun child components when props change:** This resembles a renderer loop
  and would require recreating or diffing returned structure. It conflicts with
  construct-once component semantics.
- **Expose parent slots directly to children:** This couples child source masks
  and scheduling to parent internals and makes defaults and child-local derived
  ordering ambiguous.
- **Dynamically track prop reads:** Signals would remove the need for compiler
  masks, but add observer stacks and runtime graph discovery that Vidact's
  static updater model intentionally avoids.
- **Stringify all dynamic children:** Small, but observably wrong for arrays,
  nodes, empties, nested ownership, and component composition.
- **Use a temporary fragment as the permanent structural parent:** Staging is
  useful for failure isolation, but a captured fragment becomes detached after
  commit. Marker-derived live parents preserve both staging and later updates.
- **Assign refs during element construction:** The node is not yet committed,
  cleanup ownership may not be known, and nested ranges cannot provide a stable
  ordering contract at that point.

## Consequences

Supported components can now compose reactive scalar props and compiler-owned
array blocks while retaining one-time construction and surgical DOM updates.
Dynamic child values are more general and refs establish the first commit-time
resource lifecycle. The cost is one child slot and one bridge updater per
reactive prop, comment markers for general binding ranges, and owner allocation
for each non-scalar range value.

The ABI is intentionally narrow. Prop additions/deletions through spreads, rest
and nested destructuring, and foreign React element objects require separate
decisions. Multi-root component ranges, aliased direct destructuring, ref-as-prop,
and reactive host ref identity are supported. `useRef` is naturally stable under
the compiled construct-once path. `useImperativeHandle` is supported with an
omitted or empty dependency list; reactive dependency replacement is reserved
for the shared lifecycle dependency ABI.
The former rerendering compatibility runtime was removed by
[Single client compiler and runtime path](compiled-only-client-runtime.md).

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` covers compiled prop slots,
  default factories, early-return rejection, reactive-spread rejection, and
  fail-closed untracked prop derivations.
- `packages/runtime/test/reactivity/compiled-dom.browser.test.ts` covers reactive
  parent-to-child props, branch disposal, recursive array/node/empty ranges,
  structural props moved out of fragments, defaulted and transaction-batched
  reactive props, failed-child disposal, node rollback, keyed cleanup errors,
  and ref attachment/cleanup.
- `examples/todomvc/src/TodoApp.browser.test.ts` exercises a compiler-owned keyed
  array and reactive scalar prop through `TodoList`, plus `useRef`, while
  preserving keyed row DOM identity.
- `tests/browser/corpus/apps/roster/RosterApp.browser.test.ts` verifies compiler-owned
  JSX arrays crossing a component prop with surgical record updates.
- `tests/browser/corpus/apps/multi-component/MultiComponentApp.browser.test.ts`
  verifies post-insertion imperative-handle publication, surgical state updates,
  and disposal clearing through React-shaped TSX.
- Run `cargo test --workspace`, `pnpm typecheck`, `pnpm test:runtime`,
  `pnpm test:browser`, `pnpm test:examples`, and `pnpm build:examples`.
