#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
submodule="$repo_root/vendor/oxc"

git -C "$repo_root" submodule update --init -- vendor/oxc

if expected_revision="$(git -C "$repo_root" rev-parse HEAD:vendor/oxc 2>/dev/null)"; then
  :
else
  expected_revision="$(git -C "$repo_root" rev-parse :vendor/oxc)"
fi
actual_revision="$(git -C "$submodule" rev-parse HEAD)"

if [[ "$actual_revision" != "$expected_revision" ]]; then
  echo "vendor/oxc is at $actual_revision; expected $expected_revision" >&2
  exit 1
fi

shopt -s nullglob
patches=("$repo_root"/patches/oxc/*.patch)

if (( ${#patches[@]} == 0 )); then
  echo "No Oxc patches found."
  exit 0
fi

if git -C "$submodule" apply --reverse --check "${patches[@]}" 2>/dev/null; then
  echo "Oxc patch series is already applied."
  exit 0
fi

if [[ -n "$(git -C "$submodule" status --porcelain)" ]]; then
  echo "vendor/oxc has changes that are not the complete Vidact patch series." >&2
  echo "Restore the pinned submodule before preparing it again." >&2
  exit 1
fi

git -C "$submodule" apply --check "${patches[@]}"
git -C "$submodule" apply "${patches[@]}"
echo "Applied ${#patches[@]} Oxc patch(es) to $expected_revision."
