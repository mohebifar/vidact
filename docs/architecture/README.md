# Vidact architecture decisions

These documents record accepted compiler/runtime contracts and their rationale. Plans describe intended work; architecture decisions describe boundaries the implementation must preserve.

- [React analysis boundary](react-analysis-boundary.md) — React Compiler analysis is an input to Vidact's stable IR, not the DOM lowering or runtime ABI.
- [Keyed record updaters and owned blocks](keyed-record-updaters-and-owned-blocks.md) — stable keys retain row owners and nodes while static item/component updaters patch them; compiled array blocks can cross props with single-mount ownership.
- [Compiled component props, live ranges, and refs](compiled-component-props-live-ranges-and-refs.md) — reactive parent bindings feed child-local updater slots; adopted scopes, marker-derived live parents, range-owned dynamic values, and commit-time refs define component composition.
- [Runtime and compiler test-suite ownership](test-suite-ownership.md) — direct runtime browser tests live with the runtime, while the browser corpus contains only React-shaped TSX compiled through Vidact.
