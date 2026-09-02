# Release policy

Vidact packages use semantic versioning as one coordinated release train:
`@vidact/compiler`, `@vidact/runtime`, `@vidact/vite`, `@vidact/start`,
`@vidact/react-types`, `@vidact/test-support`, and the `vidact` generator publish
the same version.
Changesets declares these packages as one fixed group, so a release bump cannot
change only part of the public package set. Package versions remain at the last
released value until the automated Version Packages pull request consumes the
pending changesets.
The generated `@vidact/compiler-*` platform packages carry that exact version
and are optional dependencies of `@vidact/compiler`. Releases require Node 24
or newer and are tested in the pinned Chromium, Firefox, and WebKit versions
from the workspace lockfile.

## Compatibility

- A breaking compiler/runtime protocol change requires a major package version
  and a new protocol identifier. Server and hydration artifacts must use the
  same protocol version.
- Removing accepted syntax, changing an accepted observable runtime behavior,
  or changing a public diagnostic code is a breaking change.
- Adding accepted syntax or an opt-in feature is minor. Correctness fixes that
  preserve the documented contract are patch releases.
- React Canary/experimental surfaces do not enter the stable contract until
  promoted and intentionally classified by Vidact.

## Release gates

Before publishing, maintainers run `pnpm check`, which includes the runtime-size,
compiler cold/incremental performance, runtime throughput/allocation/retention,
and clean tarball consumer gates. Every package builds with `tsdown` in unbundle
mode, so `dist` mirrors `src` file for file and emits ESM, declarations,
declaration maps, and source maps. Packages publish `src` alongside `dist` so
those maps resolve in a consumer's `node_modules`; the smoke test installs the exact tarballs
outside the workspace and verifies a real native compilation, the `vidactc`
wrapper, the `vidact` generator, runtime, server, test, Vite, and TSX type entry
points without Cargo.

The supported native matrix is macOS arm64/x64, Windows x64, and Linux
arm64/x64 for both glibc and musl. A release is not publishable unless all seven
artifacts are present and pass their native package job. napi-rs publishes one
platform package per artifact, followed by `@vidact/compiler`; the remaining
packages publish in dependency order.

Packages publish with public access and npm provenance enabled. A release must
be built from a clean tagged commit in CI, retain the lockfile and compiler
submodule revision, and include Changesets-generated package changelogs that
call out protocol, diagnostic, feature-flag, browser-policy, and migration
changes.

## Publishing

1. Add a changeset file to every pull request. For a public package change,
   select the semantic bump and describe the consumer-visible change. Use
   `pnpm changeset --empty` only for changes that intentionally publish nothing.
   CI rejects a pull request without one of these files before installing the
   Rust toolchain.
2. Merge the pull request. The `Version packages` workflow opens or updates a
   coordinated version pull request with all five package versions and their
   generated changelogs.
3. Review and merge that version pull request, run `pnpm check` from a clean
   checkout, and create an annotated `v<version>` tag at the merge commit.
4. Push the tag. The `Release` workflow rejects a tag that does not
   exactly match every public package version, builds all native targets, then
   publishes with the npm tag `latest` or `next` for prereleases.

Before the initial release, public manifests use `0.0.0`. The checked-in initial
minor changeset makes the first Version Packages pull request produce `0.1.0`.

The first version of each root and generated platform package must be published
manually by an npm owner using required two-factor authentication. After that
bootstrap, configure each package's npm trusted publisher for
`.github/workflows/release.yml` in this repository. The workflow requests the
OIDC `id-token: write` permission and uses npm provenance. Do not configure a
write-capable `NPM_TOKEN` for the steady-state workflow; trusted publishing is
the credential path.
