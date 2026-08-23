# no-server-hidden-activity-text-root

- Status: Proposed
- Future package: Vidact Oxlint plugin
- Recommended severity: Warning

## Why

Vidact hides an initially hidden server `Activity` by adding an inline display
override to each top-level host element. A top-level text node has no style
surface. Wrapping it only on the server would change the direct-DOM shape and
prevent matching hydration from claiming the same nodes.

The server target therefore rejects non-empty top-level text output beneath an
initially hidden `Activity`. Client-only text Activities remain supported by
moving their `Text` node behind a stable comment while hidden.

## Incorrect

```tsx
function SecretLabel() {
  return <Activity mode="hidden">private text</Activity>
}
```

## Preferred

```tsx
function SecretLabel() {
  return (
    <Activity mode="hidden">
      <span>private text</span>
    </Activity>
  )
}
```

Give server-rendered hidden content a host root that can carry the deterministic
display override without adding a hydration-only wrapper.

## Proposed check

Report an `Activity` whose `mode` is statically `"hidden"` and whose direct
children include non-empty JSX text or a scalar expression that is provably a
string or number. Also report a locally resolvable component child when every
return path produces a scalar root. Do not guess through unresolved component
or library boundaries.

## False positives and configuration

A dynamic mode may be visible on the server, and an unresolved component may
return a host element. The future rule should report only shapes it can prove
and leave the server runtime check as the final boundary.

## Compiler boundary

The source is valid for client-only rendering, where Vidact can detach and
restore the same text node. Whether the module will execute on the server is an
adapter and application decision, so the general client compiler must not reject
the shape unconditionally.

## Evidence

See [Retained Activity connections](../architecture/retained-activity-connections.md)
for the host-style and text-retention decision. Server rejection is implemented
in `packages/runtime/src/server.ts` and covered by
`packages/runtime/test/server/server.test.tsx`.
