# Patched Oxc submodule

- Decision state: Accepted
- Decided: 2026-08-22

## Context

Vidact needs one private seam in Oxc's Rust React Compiler: owned snapshots of
the analyzed HIR control-flow graph, def-use relationships, and optimized
reactive-scope facts before React code generation. The published crate does not
expose that seam.

The spike copied the complete published `oxc_react_compiler` crate into this
repository. That made the experiment build, but it hid the effective fork among
more than one hundred upstream files, discarded upstream commit provenance, and
made an upgrade equivalent to replacing and re-auditing the whole directory.
Using registry releases for Vidact's other Oxc crates also risked incompatible
Rust types whenever the patched compiler resolved those crates from a different
source.

## Decision

Track the complete official Oxc repository as the `vendor/oxc` git submodule,
pinned to immutable upstream commit
`45a17c25d188bf1b289638483e2bc61adbadd364` for Oxc `0.143.0`.

Keep every Vidact-owned Oxc change as a mail patch under `patches/oxc`. Maintain
that series with Microsoft's `git-go-patch`, pinned to Go module `v0.0.16`
(tool version `v1.0.1`). A normal checkout and CI use `scripts/prepare-oxc.sh` to
initialize the pinned submodule and apply the same patches without requiring Go
or `git-go-patch`.

The series has one upstream-shaped patch: expose owned pre-codegen analysis
snapshots. It captures the CFG before conversion to the codegen-oriented
reactive tree, def-use facts before lvalue pruning, and optimized scopes before
React codegen. Vidact-specific DOM classification, updater IR, and runtime policy
remain outside Oxc.

## Compiler and dependency contract

- The outer repository records only a pristine, upstream-reachable Oxc gitlink.
- `scripts/prepare-oxc.sh` applies the patch series as submodule working-tree
  changes; it is idempotent for the complete series and rejects unrelated dirt.
- Every directly used Oxc crate resolves from `vendor/oxc/crates/*`, so AST,
  semantic, span, and React Compiler types come from one Cargo source identity.
- `git-go-patch apply` may create temporary commits inside the submodule for
  editing and extraction. Those commits must never replace the staged outer
  gitlink.
- The patched crate exports owned `FunctionAnalysis` data containing plain
  integers, enums, strings, and span pairs. Arena-backed Oxc and React Compiler
  HIR types do not escape the adapter, and Vidact translates the terminal graph
  again into its own `ControlFlowFacts`.

## Invariants

- `git ls-files --stage vendor/oxc` records the audited upstream revision, not a
  patched temporary commit.
- A pristine pinned submodule accepts every checked-in patch with `git apply
  --check`.
- Re-extracting an unchanged series with `git-go-patch` is deterministic.
- The patch series contains no Vidact DOM, runtime, or updater policy.
- Vidact never mixes registry and path instances of directly used Oxc crates.
- An upstream sync updates the pristine gitlink first, then rebases and extracts
  patches; it never stages the post-patch submodule HEAD.

## Alternatives considered

- **Install `oxc_react_compiler` from crates.io:** smallest dependency footprint,
  but the required pre-codegen analysis is private.
- **Keep copying the published crate:** builds without submodules, but obscures
  the owned diff and makes upstream provenance and rebases unreliable.
- **Maintain a permanent hosted Oxc fork:** conventional Cargo Git dependency,
  but moves a tiny integration seam into another release and access-control
  surface. The in-repository patch series is easier to audit with Vidact changes.
- **Submodule the React repository:** wrong source boundary for this integration;
  Vidact consumes Oxc's Rust port and Oxc crate graph.
- **Rebuild the analysis on `oxc_semantic`:** avoids the seam but duplicates
  React Compiler's control-flow, SSA, alias, effect, and reactive-scope work.

## Consequences

The effective fork remains one reviewable patch instead of a copied source tree,
and upstream syncs become explicit rebases. The complete terminal and
instruction-kind enums intentionally make upstream HIR drift a compile failure
instead of silently mapping a new construct to an unsafe fallback. Fresh
checkouts must initialize and prepare the submodule before Cargo commands.
Contributors editing the seam need Go and the pinned `git-go-patch` binary;
ordinary builds and CI do not. The whole Oxc checkout is larger on disk than one
copied crate, but it supplies consistent path dependencies and preserves exact
upstream history.

## Verification

- `scripts/prepare-oxc.sh`
- `git -C vendor/oxc apply --reverse --check ../../patches/oxc/*.patch` after
  preparation
- `cargo test -p vidact-compiler`
- `cargo test --workspace`
- `.agents/skills/manage-patched-oxc-submodule/SKILL.md` defines the edit and
  upstream-sync procedure.
