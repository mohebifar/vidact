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

A rest binding becomes one child-local object state slot. Its initializer reads
the compiler-owned full props object, excludes every directly destructured
public key, and resolves each remaining upstream compiled binding. Bridge
subscriptions replace the object slot whenever any included value changes.
Direct destructured props keep their existing independent slots, addressed by
public key even when their child-local binding is aliased.
The same object-slot primitive represents an identifier-form props parameter
with no exclusions, preserving reactive direct/computed reads and forwarding
spreads without exposing upstream binding descriptors.

One reactive intrinsic JSX spread lowers to a capability-imported directive.
The directive owns the currently visible property set, diffs names and values,
applies deletion as `undefined`, replaces event listeners with cleanup, and
participates in transactional publication rollback. Explicit JSX properties
and explicit JSX children authored after the spread are compiler-recorded
overrides and never become owned by the spread.

The substantial spread implementation lives in its own runtime module. Direct
DOM construction retains only a small reserved-directive dispatch, so chunks
without reactive spreads omit the diff, event, cleanup, and rollback machinery.

A reactive component spread lowers to a separate capability-imported directive.
Component construction consumes the directive and supplies the child with a
proxy over explicit props plus stable per-key `CompiledBinding` descriptors.
The proxy reports the spread's current enumerable keys, while
`createCompiledRestProp` subscribes to the whole spread binding so newly added
and deleted keys refresh the child-local rest object. Explicit properties after
the spread remain ordinary own properties and take precedence.

## Compiler and runtime contract

- `createCompiledRestProp(scope, mask, props, excludedNames)` returns the same
  exact-replacement slot shape used by ordinary compiled props, but derives the
  rest view from the full input object and resolves its static values and
  compiled bindings on every upstream invalidation.
- `compiledSpread(binding, overriddenNames)` returns one private enumerable
  directive property. JSX object-spread ordering places it at the source spread
  position.
- `compiledComponentSpread(binding, overriddenNames)` returns an internal symbol
  directive consumed only by component construction. Its proxy synthesizes one
  stable binding per requested public key and exposes the original whole-object
  binding to rest-slot construction.
- The compiler currently requires the reactive spread to precede explicit
  properties and rejects another spread on the same intrinsic or component.
  This avoids silently incorrect fallback-layer behavior until the directive
  owns a complete ordered prop-layer stack.
- `children`, `key`, `ref`, `dangerouslySetInnerHTML`, and private namespace
  metadata require dedicated ownership paths and fail if supplied dynamically
  by the spread. Explicit children are recorded as an override.
- Component-spread `key` and spread-owned `children` still require dedicated
  identity and child-ownership paths; those shapes are not part of the accepted
  component-spread contract.

## Invariants

- Removing a key from the next spread object removes its live DOM effect.
- An explicit following JSX property wins initially and after every spread
  update, even when the dynamic object contains the same name.
- Replacing or deleting an event property removes the previous listener once.
- A failed property application rolls back earlier properties in the same
  spread publication and leaves the previous spread object current.
- A rest object exposes resolved values, not `CompiledBinding` descriptors, and
  its consumer component does not rerun.
- A component spread can add or delete direct and rest keys without reinvoking
  the child, and deleting a defaulted direct prop reactivates its default.
- Deleting a top-level object used by nested destructuring re-evaluates its
  container defaults and nested leaf defaults without remounting the child.
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

Common state-object intrinsic spreads, reactive component spreads, and
rest-forwarding components can update surgically, including property deletion
and event replacement. The accepted surface is intentionally narrower than
arbitrary React prop-layer composition; unsupported ordering and ownership
shapes produce source diagnostics or stable runtime errors rather than
snapshots.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` proves rest-slot and spread
  directive lowering for intrinsic and component targets.
- The compatibility corpus accepts `reactive-spread.tsx`,
  `reactive-component-spread.tsx`, and `rest-props.tsx`.
- `tests/browser/corpus/apps/dom-semantics/DomSemanticsApp.browser.test.ts`
  proves property add/update/delete, explicit override precedence, event
  replacement, component direct/default/rest propagation, and retained node
  identity.
- `pnpm --filter @vidact/browser-corpus test`
- `pnpm size`
