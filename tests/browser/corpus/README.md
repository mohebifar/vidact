# Browser corpus

These tests run in a real Chromium instance through Vitest Browser and
Playwright. They are organized by semantic surface rather than implementation
module:

- `reactivity`: static dependency masks, derived propagation, batching, and
  wide components
- `arrays`: keyed structural reconciliation and DOM identity
- `lifecycle`: disposal and invalidation boundaries

The corpus is the executable compatibility contract for generated Vidact output.
As the compiler comes online, each accepted React fixture should compile to a
module that is imported by the appropriate browser corpus. Rejected fixtures
belong in compiler diagnostic tests, not browser tests.

Every regression fixture should state the observable browser result. Avoid
snapshots of generated JavaScript when DOM behavior is the actual contract;
codegen snapshots supplement browser behavior but do not replace it.
