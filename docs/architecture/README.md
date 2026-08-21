# Vidact architecture decisions

These documents record accepted compiler/runtime contracts and their rationale. Plans describe intended work; architecture decisions describe boundaries the implementation must preserve.

- [React analysis boundary](react-analysis-boundary.md) — React Compiler analysis is an input to Vidact's stable IR, not the DOM lowering or runtime ABI.
- [Keyed record updaters and owned blocks](keyed-record-updaters-and-owned-blocks.md) — stable keys retain row owners and nodes while static item/component updaters patch them; compiled array blocks can cross props with single-mount ownership.
