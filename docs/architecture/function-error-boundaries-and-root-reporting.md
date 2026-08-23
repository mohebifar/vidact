# Function error boundaries and root reporting

- Decision state: Accepted
- Decided: 2026-08-23

## Context

React's public catch boundary is class-based, but Vidact deliberately supports
construct-once function components rather than a class instance or element
renderer. Errors can also escape after construction: compiled computations,
DOM publication, native event handlers, layout work, passive effects, external
stores, and cleanup all execute under a logical owner.

A boundary must not publish a fallback until a failed update has rolled back.
Otherwise recovery could retain partial DOM writes, attached refs, listeners,
or resources from the abandoned content owner.

## Decision

Vidact exposes an adapted function API:

```ts
errorBoundary(
  render,
  (error, reset) => fallback,
  onError?,
)
```

`render` is lazy and mounts under a child owner whose nearest logical boundary
is this boundary. A caught failure first aborts or rolls back its publication,
then stages and commits the fallback under the parent boundary. Only after the
fallback commits does Vidact invoke the local `onError` and root
`onCaughtError` callbacks. Calling `reset` disposes the fallback and attempts a
fresh content owner; another failure returns to the fallback.

`createRoot` and `mountCompiled` accept `onCaughtError` and `onUncaughtError`.
Uncaught construction or mount failures report through `onUncaughtError` and
leave the host's previous children unchanged with a disposable root handle.
Uncaught update failures preserve the last committed DOM and keep the owner
available for a later valid update. Without a root callback, the original error
is rethrown.

Logical owner restoration is the common propagation mechanism for context,
root identity, cleanup, and errors. It follows component, branch, list, and
portal ownership rather than physical DOM ancestry. Native event errors and
passive effect errors enter the same route explicitly.

## Invariants

- Failed publication is rolled back before fallback construction starts.
- Fallback work cannot be caught by the boundary whose content failed; it
  propagates to the parent boundary or root.
- Replaced content and fallback owners are disposed exactly once.
- A reset constructs a new content owner rather than reviving disposed work.
- Portal descendants retain logical boundary ancestry.
- Root callbacks do not require React class components or a public element
  tree.

## Bundle consequence

Failure ownership is default-core infrastructure because every updater and
commit must identify the logical route for an exception. The boundary renderer
itself remains usage-reachable, but transaction-local owner tracking adds about
220 gzip bytes to representative default applications. The measured ceilings
are explicitly revised by 224 bytes rather than silently bypassing the size
gate:

| Fixture      | Before errors | With errors | Revised ceiling |
| ------------ | ------------: | ----------: | --------------: |
| Counter      |       7,500 B |     7,725 B |         7,803 B |
| Control flow |       7,858 B |     8,082 B |         8,129 B |
| Keyed list   |       8,644 B |     8,870 B |         8,932 B |
| TodoMVC      |      10,219 B |    10,445 B |        10,526 B |

## Alternatives considered

- **Implement React class boundaries:** would introduce the class/instance
  renderer identity Vidact intentionally excludes.
- **Catch only initial rendering:** misses the more common failures in
  reactive computation, commit, events, stores, and effects.
- **Mount fallback inside the failing transaction:** risks combining abandoned
  writes with recovery DOM and resources.
- **Dispose the entire root for every update error:** prevents local recovery
  and discards known-good committed UI unnecessarily.

## Verification

- `packages/runtime/test/lifecycle/error-boundaries.browser.test.ts` covers
  rollback-before-fallback, reset, event/effect routing, and root reporting.
- `tests/browser/corpus/apps/error-boundary/ErrorBoundaryApp.browser.test.ts`
  covers compiled render, native-event, and passive-effect failures.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/function-error-boundary.tsx`
  records the adapted function syntax.
- `crates/vidact-compiler/tests/fixtures/compatibility/rejected/class-error-boundary.tsx`
  proves class boundary syntax fails at its React superclass with migration
  guidance.
- `pnpm test:runtime`
- `pnpm test:browser`
- `pnpm size`
