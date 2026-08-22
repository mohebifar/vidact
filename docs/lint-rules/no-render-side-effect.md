# no-render-side-effect

- Status: Proposed
- Future package: Vidact Oxlint plugin
- Recommended severity: Warning

## Why

A dependency-driven render expression may execute at mount and again whenever its
tracked inputs change. Non-destructive but observable work in that expression can
therefore run more often than its author expects.

## Incorrect

```tsx
function Profile({ user }: { user: User }) {
  analytics.track("profile-rendered", user.id)
  return <h1>{user.name}</h1>
}

function Result({ ready }: { ready: boolean }) {
  return <p>{console.log("checking readiness") || (ready ? "ready" : "waiting")}</p>
}
```

## Preferred

```tsx
function Profile({ user }: { user: User }) {
  const handleOpen = () => analytics.track("profile-opened", user.id)
  return <button onClick={handleOpen}>{user.name}</button>
}
```

Move event-driven work into event handlers. Move lifecycle-driven work into the
appropriate effect primitive once that primitive is supported by Vidact.

## Proposed check

Report known logging, analytics, tracing, and other observable calls in component
render code and in callbacks reevaluated by generated updaters. Destructive writes
that the compiler can prove remain compilation errors instead.

## False positives and configuration

Debug logging and deliberately idempotent instrumentation may be acceptable. The
future rule needs configurable effectful-call lists and local suppression.

## Compiler boundary

These calls can be valid JavaScript and need not corrupt render state. Whether
their repetition is intended is a developer-policy question, so Vidact should
warn through linting rather than reject every call during compilation.
