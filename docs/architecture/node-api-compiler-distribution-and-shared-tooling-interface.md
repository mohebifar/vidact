# Node-API compiler distribution and shared tooling interface

- Decision state: Accepted
- Decided: 2026-08-23
- Supersedes in part: [Versioned compiler targets and feature gates](versioned-compiler-targets-and-feature-gates.md)

## Context

The Vite plugin previously spawned `vidactc` and workspace consumers needed a
Rust toolchain or an explicitly supplied compiler executable. That transport
made installation, cross-platform releases, error handling, and programmatic
compiler use unnecessarily different. A public npm release needs one supported
JavaScript API while preserving a narrow, testable Rust boundary.

## Decision

`vidact-compiler` owns compilation, analysis, configuration validation, and the
versioned JSON protocol. `vidact-node` is a thin napi-rs adapter over those Rust
functions. It provides synchronous calls for command-line and build-tool paths
and worker-pool-backed asynchronous calls for programmatic consumers.

`@vidact/compiler` is the public compatibility layer. Its hand-written
TypeScript facade validates the native protocol, normalizes native failures,
and exposes stable compile and analysis types. Generated napi-rs bindings are
an implementation detail. `@vidact/vite` calls this facade directly, and the
published `vidactc` command is a JavaScript wrapper over the same facade. The
standalone Rust CLI remains available for compiler development and debugging,
but is not the npm package transport.

The package ships prebuilt Node-API addons as optional platform packages for
macOS arm64/x64, Windows x64, and Linux arm64/x64 on glibc and musl. npm
consumers do not compile Rust or download an executable during installation.

Changesets owns source version changes and per-package changelogs. The six
public packages are one fixed group and version together. A Changesets workflow
opens the version pull request, but it does not publish: a reviewed coordinated
`v*` tag remains the input to the separate native assembly and trusted npm
publishing workflow. Package manifests provide the versions published to npm;
the compiler tarball version selects `next` for prereleases and `latest` for
stable releases.

## Compiler and runtime contract

The Rust protocol module is the only producer of `vidact-analysis-v1`,
`vidact-compile-v2`, and `vidact-runtime-v1` payloads. The Node-API adapter
converts those payloads directly into structured JavaScript objects; the
JavaScript facade validates them before exposing the public types. Only the CLI
adapters serialize the payloads as JSON text. Vite rejects a compiler/runtime
protocol mismatch before accepting generated code.

## Invariants

- Rust CLI, Node-API sync/async calls, and Vite use the same Rust protocol
  functions and compilation configuration.
- Generated napi-rs loader and binding declarations are not the public API.
- A normal npm install never requires Rust, Cargo, or a postinstall download.
- Each supported target has exactly one version-matched optional platform
  package before the root compiler package publishes.
- Changesets versions all six public packages together before a release tag is
  created.
- A tarball-installed consumer can compile TSX and invoke `vidactc` outside the
  workspace.

## Alternatives considered

- **Continue spawning a Rust executable:** simple inside the repository, but
  exposes path/process management and toolchain availability to every consumer.
- **Publish generated napi-rs exports directly:** less facade code, but makes
  generator output and native transport details part of the semver contract.
- **Compile or download during postinstall:** reduces release artifacts, but
  makes installs network- and toolchain-dependent and weakens reproducibility.
- **Remove the Rust CLI:** reduces one adapter, but loses a useful compiler-only
  diagnostic path at negligible maintenance cost once it shares the protocol.
- **Let Changesets publish directly:** fits JavaScript-only workspaces, but does
  not own Vidact's seven-target native build, optional-package assembly, or
  retry-safe coordinated tarball publication.

## Consequences

JavaScript tooling gets an in-process API and one error/type contract. Vite no
longer manages child processes or workspace Cargo builds. Releases become more
complex because seven native artifacts and their npm packages must be built and
published before the root facade, and adding a supported platform is a release
contract change. Version intent is explicit in pull requests and changelog
generation is automated, while tag creation remains a deliberate maintainer
step after the version pull request merges. The release workflow trusts that
reviewed tagged tree instead of passing duplicate version validation state
between jobs.

## Verification

- `crates/vidact-compiler/tests/vidactc.rs`
- `packages/compiler/test/compiler.test.ts`
- `packages/vite-plugin/test/compiler-client.test.ts`
- `scripts/verify-packages.mjs`
- `.changeset/config.json`
- `.github/workflows/version-packages.yml`
- `cargo test -p vidact-compiler --test vidactc`
- `cargo test -p vidact-node`
- `pnpm --filter @vidact/compiler test`
- `pnpm --filter @vidact/vite test`
- `pnpm test:packages`
- `pnpm changeset:check`
- `pnpm changeset status --since origin/main`
