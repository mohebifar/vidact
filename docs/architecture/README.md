# Vidact architecture decisions

These documents record accepted compiler/runtime contracts and their rationale. Plans describe intended work; architecture decisions describe boundaries the implementation must preserve.

- [React analysis boundary](react-analysis-boundary.md) — React Compiler supplies an owned typed CFG plus def-use facts while Vidact classifies supported syntax through OXC AST and semantic identities before lowering to its stable IR.
- [Patched Oxc submodule](patched-oxc-submodule.md) — the official Oxc repository stays pinned at a pristine upstream commit while Vidact's narrow React Compiler analysis seam is maintained as a deterministic patch series.
- [Component spans and compatibility corpus](component-spans-and-compatibility-corpus.md) — exact source spans join each React Compiler snapshot to its component, while a versioned manifest defines accepted, rejected, and intentionally different fixtures.
- [Keyed record updaters and owned blocks](keyed-record-updaters-and-owned-blocks.md) — stable keys retain row owners and nodes while static item/component updaters patch them; compiled array blocks can cross props with single-mount ownership.
- [Compiled component props, live ranges, and refs](compiled-component-props-live-ranges-and-refs.md) — reactive parent bindings feed child-local updater slots; adopted scopes, marker-derived live parents, range-owned dynamic values, and commit-time refs define component composition.
- [Owned component result ranges](owned-component-result-ranges.md) — every compiled component returns a single-mount, marker-owned range that supports wrapper-free multi-root, scalar, and empty output with failure-atomic publication.
- [Render-flow normalization and identity](render-flow-normalization-and-identity.md) — exact React Compiler return sites lower into a Vidact DAG whose type/key/position rule preserves, replaces, or dispatches render alternatives without source-text inference.
- [Aligned render slots and identity dispatch](aligned-render-slots-and-identity-dispatch.md) — equal position/type/key alternatives retain their owned nodes through bindings, while a narrow staged dispatcher remounts only when runtime identity changes.
- [Runtime and compiler test-suite ownership](test-suite-ownership.md) — direct runtime browser tests live with the runtime, while the browser corpus contains only React-shaped TSX compiled through Vidact.
