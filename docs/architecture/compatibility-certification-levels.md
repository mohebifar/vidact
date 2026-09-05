# Compatibility certification levels

- Decision state: Accepted
- Decided: 2026-09-05
- Supersedes certification results in: [shadcn Base UI as a compatibility corpus](shadcn-base-ui-compatibility-corpus.md)

## Context

Vidact accepts a bounded React-shaped source language and can compile qualified
published dependencies. A successful transform alone does not prove that a
component server-renders, mounts, responds correctly to input, preserves its DOM
owners, or type-checks against Vidact's owned JSX values. Earlier documentation
mixed those levels and carried registry counts after the corresponding corpus
and browser proofs had been removed.

## Decision

Every compatibility claim names one or more independently certified levels:

1. **Compilation** means a named source and target lower without residual React
   runtime imports, or fail with an expected source-located diagnostic.
2. **SSR** means the compiled server target executes and produces asserted HTML
   for the named behavior.
3. **Browser behavior** means a compiled application mounts and the named user
   interaction produces the asserted state and accessibility result in every
   configured browser.
4. **DOM ownership** adds retained node identity, bounded mutations, and terminal
   cleanup to the browser behavior proof.
5. **Typing** means the named authoring surface passes the repository TypeScript
   contract without an unchecked package-boundary cast.

Certification attaches to exact package versions, entries, source shapes,
targets, features, and tests. Dependency discovery remains syntax- and
provenance-based; a passing Base UI entry does not create a package allowlist or
certify sibling entries. A local shadcn wrapper test certifies that application
path, not the official registry.

The user-facing [React compatibility matrix](../react-compatibility.md#current-certification-evidence)
owns the live evidence table. `scripts/verify-compatibility-evidence.mjs` runs in
`pnpm test:tools` and requires every row to link to a present executable test or
type-check fixture. A claim and its test must change together.

## Current boundary

- The compiler manifest certifies the checked-in React-shaped source subset.
- Vite integration tests certify specific Base UI 1.7.0 transform, bundle, and
  SSR paths.
- The three-browser corpus certifies published Base UI Button behavior and DOM
  ownership.
- The Shop example certifies its local wrappers over Button, Toggle, and Toggle
  Group as one application path.
- The docs example certifies only its current Vidact-native shell.
- `@vidact/react-types` certifies Vidact intrinsic JSX and DOM types. Published
  Base UI props currently cross an explicit local adapter and have no direct
  typing certification.

## Invariants

- A lower certification level is never described as evidence for a higher one.
- Browser certification names the tested package entry and browser matrix.
- DOM ownership claims include node identity and bounded mutation evidence.
- Historical counts and removed fixtures are labeled historical rather than
  redirected to unrelated tests.
- An evidence link cannot disappear while `pnpm test:tools` passes.

## Alternatives considered

- **One supported/unsupported package label:** concise, but hides target,
  interaction, ownership, and type failures behind transform success.
- **Keep historical registry counts as current guidance:** gives an apparent
  coverage percentage with no executable corpus behind it.
- **Treat the docs example as ecosystem certification:** confuses a local
  Vidact-native shell with published Base UI or shadcn behavior.
- **Check links manually:** allows routine refactors to leave authoritative
  claims pointing at deleted evidence.

## Consequences

Compatibility wording is narrower, but each claim can be reproduced. Expanding
the browser-certified dependency surface now requires focused interaction and
owner-retention tests. Registry-scale coverage can return when a versioned
corpus and its audit command are checked in again.

## Verification

- `scripts/verify-compatibility-evidence.mjs`
- `pnpm test:tools`
- `pnpm --filter @vidact/vite test`
- `pnpm --filter @vidact/browser-corpus test`
- `pnpm --filter @vidact/example-shop test`
- `pnpm --filter @vidact/react-types typecheck`
