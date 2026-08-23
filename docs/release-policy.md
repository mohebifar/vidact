# Release policy

Vidact packages use semantic versioning as one coordinated release train:
`@vidact/runtime`, `@vidact/vite`, `@vidact/react-types`, and
`@vidact/test-support` publish the same version. Releases require Node 24 or
newer and are tested in the pinned Chromium, Firefox, and WebKit versions from
the workspace lockfile.

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
and clean tarball consumer gates. The package build emits ESM, declarations,
declaration maps, and source maps; the smoke test installs the exact tarballs
outside the workspace and verifies runtime, server, test, Vite, and TSX type
entry points.

Packages publish with public access and npm provenance enabled. A release must
be built from a clean tagged commit in CI, retain the lockfile and compiler
submodule revision, and attach a changelog that calls out protocol, diagnostic,
feature-flag, browser-policy, and migration changes.
