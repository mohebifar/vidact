# Compiler-owned profiling and owner stacks

- Decision state: Accepted
- Decided: 2026-08-23
- Amends: [Compiled lifecycle effects and commit phases](compiled-lifecycle-effects-and-commit-phases.md)
- Amends: [Compact compiler/runtime ABI](compact-compiler-runtime-abi.md)

## Context

React's Profiler describes renderer work. Vidact does not rerender a Fiber tree:
components construct once, source invalidations run static updaters, structural
ranges publish directly, and Effects have explicit commit phases. Reporting a
synthetic React render duration would therefore hide the work developers need
to diagnose.

Profiling also cannot tax ordinary production applications. The `profiling`
feature is opt-in, enabling it without using a profiling API must add no bytes,
and development-only owner/debug machinery must erase from production output.

## Decision

The compiler recognizes semantic `Profiler`, `useDebugValue`, and
`captureOwnerStack` imports. All three require the `profiling` feature and fail
at their original source span otherwise. Profiler children are staged in a
compiler-generated factory so the boundary activates profiling before child
scopes construct.

A profiling owner is a compact optional extension to the logical owner tuple.
It records the named component frame, parent frame, nearest Profiler boundary,
and current debug values. The direct component construction path passes the
component function to the runtime, allowing `displayName` or the function name
to identify measurements without generated component-name strings. Development
owners retain that name so a component can activate `useDebugValue` or
`captureOwnerStack` without requiring an ancestor Profiler; the name and owner
extension erase from production output.

Reactive `useDebugValue` inputs lower to a normal compiled binding. The runtime
registers one owner-scoped updater for that binding, so owner-stack inspection
sees the latest committed debug value without reconstructing the component.
`captureOwnerStack` reads the active logical owner, including from component
callbacks, and formats the nearest-first component chain. This is a Vidact
development stack, not a Fiber or JavaScript call stack.

Profiler reports `mount` after its staged range is committed and aggregates one
`update` callback per compiled publication. Its callback uses React's six
arguments, but durations describe Vidact range/scheduler work; `baseDuration`
is the boundary's initial mount duration. Nested work reports to its own
boundary and every mounted ancestor boundary.

Development builds also publish User Timing measures named
`vidact.<kind>:<component>`, where kind is `range`, `updater`, `effect`, or
`scheduler`. The measurements wrap real work and preserve error routing and
transactional publication.

The public profiling entry activates the mutable instrumentation gate only when
a profiling API is called. When the entry is unreachable, Rollup proves the
gate false and removes the owner field, branches, measurement helpers, and
facade. When `__VIDACT_DEV__` is false, Profiler reduces to a staged transparent
range, debug values are no-ops, owner capture returns `null`, and measurement
strings are absent. Server rendering treats Profiler as transparent, never
calls `onRender` or formatters, and returns `null` owner stacks.

Component callback props share the compiled event transaction wrapper, which
is variadic and restores the callback's logical owner. DOM handlers still
receive their single native event; multi-argument callbacks such as
`Profiler.onRender` no longer lose arguments.

## Invariants

- Disabled profiling syntax fails at its original semantic React use.
- Profiler construction is staged; descendant scopes always see the boundary.
- One state publication produces at most one update callback per nearest
  Profiler boundary.
- Measurements and callbacks never cause DOM replacement or unrelated
  mutations.
- Debug values follow committed binding updates and are removed with their
  owner.
- Component callbacks preserve every argument and execute with logical context,
  error, and owner-stack ownership.
- Server and production paths do not execute development callbacks or retain
  User Timing instrumentation.
- Enabling but not using `profiling` produces the exact default artifact.

## Consequences

The callback durations are intentionally Vidact-native rather than comparable
to React Fiber render durations. Tooling should use the four User Timing kinds
to separate fine-grained compute, structural publication, Effect work, and
scheduler cost.

Owner stacks contain component names and formatted debug values but no source
locations yet. Source-mapped updater inspection can extend the same profile
context without changing the public React-shaped API.

The variadic callback correction adds a small shared-runtime cost because it is
default callback correctness, not profiling machinery. Size ceilings moved by
roughly 20–32 gzip bytes; enabled-unused profiling remains exactly equal to the
new default artifact.

## Verification

- Compiler unit and compatibility corpora cover feature diagnostics, staged
  children, reactive debug bindings, and preserved owner-stack calls.
- Server compiler/runtime tests cover transparent markup and prove callbacks
  and formatters do not run.
- `tests/browser/corpus/profiling` proves six-argument mount/update callbacks,
  current debug values, owner context, all four performance tracks, and a
  one-text-node mutation envelope in Chromium, Firefox, and WebKit. The paired
  profiling hydration corpus proves zero-churn server-range adoption and later
  update profiling.
- Vite tests cover target-specific client, hydration, and server facades.
- `tests/runtime-size/measure.mjs` proves the enabled-unused artifact is the
  8,104-byte default and the representative production profiling artifact is
  9,720 bytes without development instrumentation strings.
