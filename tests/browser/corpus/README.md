# Browser corpus

The app corpus contains small React-shaped applications that pass through the
same production-facing pipeline as user code:

```text
app.tsx -> @vidact/vite -> Rust compiler -> @vidact/runtime -> Chromium
```

Tests import the application's `.tsx` entry point, mount the compiled component,
drive it through browser events, and assert both visible behavior and surgical
DOM updates. A fixture that constructs runtime primitives directly is useful
infrastructure coverage, but it is not an app-corpus entry.

## Compiled mini apps

- `apps/counter`: scalar and derived state, attributes, events, and a
  conditional range
- `apps/roster`: keyed arrays, same-key record updates, reordering, appending,
  and a JSX array passed through component props
- `apps/control-flow`: early returns, aligned alternatives, JavaScript logical
  values, terminal switches, dynamic keys, event replacement, focus and nested
  keyed identity, disposed branches, and no-op mutation envelopes
- `apps/derived-control-flow`: React Compiler SSA/phi-derived objects and arrays,
  inactive-input zero-mutation behavior, active text/attribute updates, and
  same-key row identity across branch changes

## Supporting runtime coverage

The remaining tests are organized by semantic surface:

- `reactivity`: static dependency masks, derived propagation, batching, and
  wide components
- `arrays`: keyed structural reconciliation and DOM identity
- `lifecycle`: disposal and invalidation boundaries
- `@vidact/test-support`: shared MutationObserver assertions and their own
  browser coverage

The compiled mini apps are the executable end-to-end compatibility contract for
Vidact's supported React surface. Rejected syntax belongs in compiler diagnostic
tests; accepted syntax must be exercised through a compiled app here.

Every regression fixture should state the observable browser result. Avoid
snapshots of generated JavaScript when DOM behavior is the actual contract;
codegen snapshots supplement browser behavior but do not replace it.
