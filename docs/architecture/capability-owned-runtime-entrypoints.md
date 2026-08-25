# Capability-owned runtime entrypoints

- Decision state: Accepted
- Decided: 2026-08-25
- Supersedes packaging portions of:
  [Versioned compiler targets and feature gates](versioned-compiler-targets-and-feature-gates.md),
  [Staged async resources and Suspense](staged-async-resources-and-suspense.md),
  [Interruptible transition publication](interruptible-transition-publication.md),
  [Compiled Actions and owned form reset](compiled-actions-and-owned-form-reset.md),
  [Compact compiler/runtime ABI and measured bundle budgets](compact-compiler-runtime-abi.md),
  [Retained Activity connections](retained-activity-connections.md), and
  [Compiler-owned profiling and owner stacks](compiler-owned-profiling-and-owner-stacks.md)

## Context

The runtime originally selected one composed facade for each combination of
target and enabled features. Files such as `async-actions.ts`,
`async-concurrent.ts`, and the feature-specific hydration entries contained no
behavior; they only re-exported other modules. Server feature paths similarly
mapped several public names to the same server implementation.

That layout duplicated the package surface without defining a new capability.
It also forced compiler output to import unrelated core helpers through feature
facades and made every additional feature combination require another source
file and export-map entry.

## Decision

Each runtime capability has one canonical implementation entry:

- `@vidact/runtime` owns core client helpers;
- `@vidact/runtime/hydrate` installs hydration and owns hydration roots;
- `@vidact/runtime/server` owns browser-free React-shaped server behavior;
- `@vidact/runtime/async`, `/concurrent`, `/actions`, `/retained-ui`, and
  `/profiling` own only their named client feature;
- `@vidact/runtime/framework`, `/framework/hydrate`,
  `/framework/protocol`, and `/framework/server` own their distinct framework
  contracts.

Combination entries and target aliases are removed. Hydration is composed by a
side-effect import of `@vidact/runtime/hydrate`, followed by imports from the
canonical feature modules. Server feature APIs are imported from the one
browser-free server entry. Framework streaming remains separate because it has
its own request, continuation, and trust-boundary behavior.

Runtime source may use imports followed by local exports for a real public
entrypoint, but it does not use `export ... from` forwarding declarations.
Pure forwarding files are forbidden by `rules/no-barrels.yaml`.

## Compiler and runtime contract

Client code generation groups referenced helpers by owner. Core helpers import
from `@vidact/runtime`; async, concurrent, Actions, and framework helpers import
from their canonical feature modules. A hydrate compilation additionally emits
the hydration side-effect import before application code executes.

The Vite React facades follow the same composition. Feature flags control which
canonical imports are emitted, not which cross-product facade name is selected.
Automatic JSX subpaths may map directly to a canonical implementation file
because the JSX module-resolution contract requires those subpaths; they do not
require alias source files.

## Invariants

- A source file that only forwards exports is not part of the runtime.
- Adding a feature does not require client/hydrate/server cross-product files.
- Hydrate output always installs hydration independently of feature selection.
- Generated helpers import from the module that implements them.
- Server feature selection never creates aliases for the canonical server
  implementation.
- Runtime source passes the `no-barrels` ast-grep rule.

## Alternatives considered

- **Keep composed facades but replace forwarding syntax with imports and local
  exports:** satisfies a syntactic lint rule while preserving the redundant
  files and cross-product package surface.
- **Export every feature from the root runtime:** removes facade combinations
  but weakens capability reachability and makes ownership of optional behavior
  unclear.
- **Generate one import from a dynamically selected facade:** keeps compiler
  output compact by one or two import declarations, but couples unrelated
  helpers and recreates the feature cross product.

## Consequences

This is an intentional breaking package change while Vidact is pre-release.
Consumers import hydration, server behavior, and each feature from their
canonical entries. Compiler output may contain several small ESM imports, which
bundlers can analyze independently and tree-shake by capability.

The package export map and source tree are smaller. Runtime ownership is visible
from import paths, and adding another optional feature does not multiply facade
files.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs`
- `packages/vite-plugin/test/compiler-client.test.ts`
- `packages/runtime/test`
- `rules/no-barrels.yaml`
- `ast-grep scan`
- `cargo test -p vidact-compiler --test surgical_codegen`
- `pnpm --filter @vidact/runtime test`
- `pnpm --filter @vidact/vite test`
