# no-async-cache-signal-read

- Status: Proposed
- Future package: Vidact Oxlint plugin
- Recommended severity: Warning

## Why

Vidact's shared Web/Node server runtime exposes `cacheSignal()` from the active
synchronous framework render stack. Calling it after an `await` in a cached
async operation returns `null` on hosts without request-local async-context
propagation, so cancellation can be missed without otherwise changing output.

## Incorrect

```tsx
const readUser = cache(async (id: string) => {
  const response = await fetch(`/users/${id}`)
  cacheSignal()?.throwIfAborted()
  return response.json()
})
```

## Preferred

```tsx
const readUser = cache(async (id: string) => {
  const signal = cacheSignal()
  const response = await fetch(`/users/${id}`, { signal: signal ?? undefined })
  signal?.throwIfAborted()
  return response.json()
})
```

## Proposed check

When a function passed directly to `cache` is async, warn when a
`cacheSignal()` call is control-flow reachable only after an `await`. Calls in
nested callbacks should be analyzed independently rather than assumed to share
the cached operation's synchronous render context.

## False positives and configuration

A framework adapter may provide its own host async-context propagation and wrap
`cacheSignal`. Such wrappers need a configured allowlist or a local suppression.
The rule should not warn when the signal is captured before suspension and only
the captured value is read later.

## Compiler boundary

The source is valid on hosts with an async-context adapter, and rejecting all
async cached operations would remove supported request caching. This is a
portability and cancellation warning, not destructive render behavior that the
compiler can universally reject.

## Evidence

- [Framework streaming, continuations, and trust boundaries](../architecture/framework-streaming-continuations-and-trust-boundaries.md)
- [`cache` and `cacheSignal` server implementation](../../packages/runtime/src/server.ts)
- [Framework server runtime tests](../../packages/runtime/test/server/framework.test.tsx)
