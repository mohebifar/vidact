---
'@vidact/compiler': patch
---

Build the Linux glibc addons against a glibc 2.17 sysroot and publish a `wasm32-wasi` fallback.

The `linux-x64-gnu` and `linux-arm64-gnu` addons were linked on `ubuntu-24.04`, so they required
glibc 2.34 and failed to load on older distributions with `Cannot find native binding`. They now
build through `@napi-rs/cross-toolchain` and CI fails the release if a newer symbol version creeps
back in. `@vidact/compiler-wasm32-wasi` is published alongside them, so a platform without a usable
native addon runs the compiler on WASI instead of erroring.
