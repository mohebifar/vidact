---
name: manage-patched-oxc-submodule
description: Maintain Vidact's pinned Oxc submodule and owned git-go-patch series. Use when adding or editing Oxc React Compiler patches, preparing the checkout, reviewing the effective fork, or syncing vendor/oxc to a newer upstream revision.
---

# Manage Patched Oxc Submodule

Keep `vendor/oxc` pristine at the upstream commit recorded by the outer repository and keep every Vidact change reviewable under `patches/oxc`.

## Invariants

- Inspect both outer and submodule status before changing anything; preserve unrelated work.
- The outer gitlink must reference a clean, upstream-reachable Oxc commit. Never stage a temporary patched submodule commit.
- Keep each patch focused on one upstream-shaped capability. Do not put Vidact runtime or DOM policy into Oxc.
- Resolve every directly used Oxc crate from `vendor/oxc`; mixing registry and path crates creates incompatible Rust types.
- Verify the effective patched tree, not only the patch files.

## Prepare a Checkout

Run `scripts/prepare-oxc.sh`. It initializes the pinned submodule and applies `patches/oxc/*.patch` as working-tree changes. It is safe to rerun when the complete series is already applied and refuses unrelated submodule changes.

## Edit the Patch Series

1. Confirm the outer gitlink is still the pinned upstream commit.
2. Run `git go-patch shell -apply` from the repository root.
3. Edit Oxc, add focused tests where appropriate, and amend or create logical commits inside the patch shell.
4. Exit the shell with status 0 so `git-go-patch` extracts deterministic patches.
5. Do not stage `vendor/oxc` after the patched commits exist.
6. Restore the normal prepared state with `scripts/prepare-oxc.sh`, then run Vidact's Rust tests.

Use `git go-patch review` or `git go-patch stage-diff` to inspect the effective fork before accepting it.

## Sync Upstream

1. Record the intended upstream release and immutable commit.
2. Return `vendor/oxc` to a clean checkout of the currently recorded gitlink.
3. Fetch and check out the new upstream commit, then stage that pristine gitlink in the outer repository.
4. Run `git go-patch shell -rebase`, resolve conflicts as upstream-shaped changes, and exit successfully to re-extract the series.
5. Confirm the staged gitlink is still the pristine upstream commit; never restage it from the patch shell.
6. Update Cargo metadata and the architecture decision, prepare from scratch, and run the full verification suite.

If a patch no longer applies conceptually, remove or rewrite it instead of preserving historical diff shape.
