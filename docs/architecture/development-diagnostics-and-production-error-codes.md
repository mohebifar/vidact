# Development diagnostics and production error codes

- Decision state: Accepted
- Decided: 2026-08-23

## Context

The browser runtime carried every descriptive invariant and usage-error message
into production bundles. These messages are useful while developing, but the
same strings appeared in the counter, control-flow, keyed-list, and TodoMVC
bundles even when their failure paths never ran.

## Decision

Runtime failures retain descriptive messages in development and use stable,
compact `Vnnn` codes in production. `@vidact/vite` defines
`__VIDACT_DEV__` from Vite's mode unless the application explicitly supplies
the define. A runtime consumed without that build-time define defaults to
development diagnostics, so an unsupported bundler configuration never
silently loses useful errors.

The code changes only the message payload. Error classes, detection points,
cleanup, rollback, and propagation remain identical between modes.

## Compiler and runtime contract

- Production compilation through `@vidact/vite` replaces
  `__VIDACT_DEV__` with `false`, allowing Oxc minification to remove descriptive
  strings and development-only interpolation.
- Development compilation replaces it with `true`.
- An application-defined `__VIDACT_DEV__` value takes precedence over the
  plugin default.
- Runtime sources guard the free constant with `typeof`, defaulting to
  development behavior when no build plugin replaces it.

Current code families are grouped by runtime concern:

| Range | Concern |
|---|---|
| `V001`–`V018` | compiled scopes, ownership, refs, publication, child values, disposed state writes, imperative-handle/effect lifecycle use, and nested prop destructuring |
| `V101`–`V106` | direct DOM refs, raw HTML namespace limits, child values, unsafe HTML gating, and reactive intrinsic/component spread values |
| `V201` | event handler values |
| `V301` | controlled form values |
| `V401` | DOM property ownership |
| `V501`–`V502` | style targets and values |
| `V601`–`V605` | raw HTML shape and target restrictions |
| `V701` | source-mask indexes |
| `V801`–`V804` | keyed-list lifecycle and key validity |

## Invariants

- Every production code maps to exactly one runtime failure condition.
- Development tests continue asserting descriptive messages, not compact
  codes.
- Production size fixtures fail if representative development messages remain
  in their emitted chunks.
- A code substitution must never change the thrown error class or control flow.

## Alternatives considered

- **Always ship descriptive errors:** simplest, but it added more than half a
  kilobyte gzip to every representative application.
- **Always ship compact codes:** smaller, but makes local development and
  unsupported bundlers unnecessarily opaque.
- **Pass messages through a shared helper:** preserves source readability, but
  call arguments keep the strings reachable unless every consumer performs
  sufficiently aggressive cross-module inlining.
- **Publish separate prebuilt development and production runtimes:** viable for
  a later package pipeline, but unnecessary while the required Vite compiler
  integration already owns a reliable build-time define.

## Consequences

Production exceptions are smaller but require the matching Vidact version when
interpreting a code. Adding a new failure condition requires a new stable code;
existing codes must not be reused for a different condition. Runtime work must
preserve the no-define development fallback.

## Verification

- `tests/runtime-size/measure.mjs` builds four production fixtures, measures
  minified and gzip bytes, and rejects retained development scheduler text.
- `packages/runtime/vitest.config.ts` forces development diagnostics for the
  runtime browser corpus.
- `pnpm size`
- `pnpm --filter @vidact/runtime test`
- `pnpm --filter @vidact/runtime typecheck`
- `pnpm --filter @vidact/vite typecheck`
