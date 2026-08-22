# no-untracked-render-read

- Status: Proposed
- Future package: Vidact Oxlint plugin
- Recommended severity: Warning

## Why

Vidact schedules generated updaters from compiler-known state and prop sources.
Reading ambient mutable state during render does not create a subscription, so the
DOM can remain stale after that external value changes.

## Incorrect

```tsx
function Layout() {
  return <nav>{window.innerWidth >= 800 ? "wide" : "compact"}</nav>
}

function Expiry({ deadline }: { deadline: number }) {
  return <span>{Date.now() >= deadline ? "expired" : "active"}</span>
}
```

## Preferred

```tsx
function Layout({ isWide }: { isWide: boolean }) {
  return <nav>{isWide ? "wide" : "compact"}</nav>
}
```

Bridge the external value into a tracked state or prop source and update it from
the external system's event or subscription mechanism.

## Proposed check

Report known ambient mutable reads, including time, viewport, storage, and
configured global stores, when they affect JSX, a render branch, or a derived
value consumed by either.

## False positives and configuration

An ambient read may intentionally be a mount-time snapshot or may be stable for
the application's lifetime. The future rule needs allowlists and a focused
suppression for those cases.

## Compiler boundary

These reads are legal and non-destructive. The compiler cannot infer when the
external system is meant to invalidate the component, so compiling them is not
itself an error.

## Evidence

See [React analysis boundary](../architecture/react-analysis-boundary.md) for the
separation between analysis facts, Vidact source IDs, and generated updater
scheduling.
