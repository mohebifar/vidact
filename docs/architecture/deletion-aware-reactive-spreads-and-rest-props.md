# Deletion-aware reactive spreads and rest props

- Decision state: Accepted
- Decided: 2026-08-23
- Amends: [Compiled component props, live ranges, and refs](compiled-component-props-live-ranges-and-refs.md)

## Context

Vidact previously rejected every reactive JSX spread and component rest binding.
Letting either form pass through ordinary object spread would snapshot compiled
bindings at construction, retain deleted DOM properties, leak replaced event
listeners, and expose binding descriptors rather than values through `...rest`.
Those are silent React compatibility failures.

## Decision

A rest binding becomes one child-local object state slot. Its initializer
resolves each upstream compiled binding, and bridge subscriptions replace the
object slot whenever any included value changes. Direct destructured props keep
their existing independent slots and are absent from the native rest object.

One reactive intrinsic JSX spread lowers to a capability-imported directive.
The directive owns the currently visible property set, diffs names and values,
applies deletion as `undefined`, replaces event listeners with cleanup, and
participates in transactional publication rollback. Explicit JSX properties
and explicit JSX children authored after the spread are compiler-recorded
overrides and never become owned by the spread.

The substantial spread implementation lives in its own runtime module. Direct
DOM construction retains only a small reserved-directive dispatch, so chunks
without reactive spreads omit the diff, event, cleanup, and rollback machinery.

## Compiler and runtime contract

- `createCompiledRestProp` returns the same exact-replacement slot shape used by
  ordinary compiled props, but resolves an object of static values and compiled
  bindings on every upstream invalidation.
- `compiledSpread(binding, overriddenNames)` returns one private enumerable
  directive property. JSX object-spread ordering places it at the source spread
  position.
- The compiler currently requires the reactive spread to precede explicit
  intrinsic properties and rejects another spread on the same intrinsic. This
  avoids silently incorrect fallback-layer behavior until the directive owns a
  complete ordered prop-layer stack.
- `children`, `key`, `ref`, `dangerouslySetInnerHTML`, and private namespace
  metadata require dedicated ownership paths and fail if supplied dynamically
  by the spread. Explicit children are recorded as an override.
- Reactive component spreads remain fail-closed until the component prop store
  can add and delete public keys after construction.

## Invariants

- Removing a key from the next spread object removes its live DOM effect.
- An explicit following JSX property wins initially and after every spread
  update, even when the dynamic object contains the same name.
- Replacing or deleting an event property removes the previous listener once.
- A failed property application rolls back earlier properties in the same
  spread publication and leaves the previous spread object current.
- A rest object exposes resolved values, not `CompiledBinding` descriptors, and
  its consumer component does not rerun.
- Applications that do not compile a reactive spread do not retain the spread
  capability module.

## Alternatives considered

- **Apply the next object without diffing:** cannot remove omitted properties or
  listeners and therefore silently diverges from object-spread semantics.
- **Teach every DOM prop path about spread layers:** makes the default runtime
  carry the full feature. A compiler-emitted directive preserves capability
  reachability.
- **Treat rest as a mount-time object:** exposes stale values as soon as a parent
  binding changes.
- **Accept arbitrary ordered spread stacks immediately:** correct fallback
  resurfacing needs an explicit layer model. The compiler rejects those shapes
  until that model is implemented and tested.

## Consequences

Common state-object intrinsic spreads and rest-forwarding components can update
surgically, including property deletion and event replacement. The accepted
surface is intentionally narrower than arbitrary React prop-layer composition;
unsupported ordering and ownership shapes produce source diagnostics or stable
runtime errors rather than snapshots.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` proves rest-slot and spread
  directive lowering.
- The compatibility corpus accepts `reactive-spread.tsx` and `rest-props.tsx`.
- `tests/browser/corpus/apps/dom-semantics/DomSemanticsApp.browser.test.ts`
  proves property add/update/delete, explicit override precedence, event
  replacement, rest propagation, and retained node identity.
- `pnpm --filter @vidact/browser-corpus test`
- `pnpm size`
