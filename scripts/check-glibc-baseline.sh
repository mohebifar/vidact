#!/usr/bin/env bash
# Fail when a shared object requires a newer glibc than the agreed baseline.
#
# usage: check-glibc-baseline.sh <baseline-version> <shared-object>...
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: ${BASH_SOURCE[0]##*/} <baseline-version> <shared-object>..." >&2
  exit 2
fi

baseline="$1"
shift

status=0

for object in "$@"; do
  required="$(readelf --wide --version-info "$object" |
    { grep --only-matching 'GLIBC_[0-9][0-9.]*' || true; } |
    sed 's/^GLIBC_//' |
    sort --unique --version-sort)"

  if [[ -z "$required" ]]; then
    echo "$object requires no versioned glibc symbols"
    continue
  fi

  too_new="$(
    for version in $required; do
      if [[ "$(printf '%s\n%s\n' "$baseline" "$version" | sort --version-sort | tail -n1)" != "$baseline" ]]; then
        echo "$version"
      fi
    done
  )"

  if [[ -n "$too_new" ]]; then
    echo "::error::$object requires glibc $(echo "$too_new" | tr '\n' ' ')but the baseline is $baseline" >&2
    status=1
  else
    echo "$object requires at most glibc $(echo "$required" | tail -n1)"
  fi
done

exit "$status"
