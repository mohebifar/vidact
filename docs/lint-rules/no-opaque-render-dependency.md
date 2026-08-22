# no-opaque-render-dependency

- Status: Proposed
- Future package: Vidact Oxlint plugin
- Recommended severity: Warning

## Why

An opaque function can read hidden mutable state even when all visible arguments
are tracked. Vidact can schedule the call when those arguments change, but it
cannot subscribe to dependencies hidden inside the callee.

## Incorrect

```tsx
import { shouldDisplay } from "./policy"

function Profile({ user }: { user: User }) {
  if (shouldDisplay(user)) {
    return <UserCard user={user} />
  }
  return null
}
```

If `shouldDisplay` also reads a mutable feature-flag singleton, a flag change does
not invalidate this branch.

## Preferred

```tsx
function Profile({ user, profileEnabled }: Props) {
  if (profileEnabled && user.status === "active") {
    return <UserCard user={user} />
  }
  return null
}
```

Pass every invalidating value through a tracked state or prop source. Pure helper
calls remain appropriate when all dependencies are explicit.

## Proposed check

Report calls without known purity and dependency summaries when their result
controls JSX, a render branch, or a derived value consumed by either. The future
rule should recognize standard pure operations and configured project helpers.

## False positives and configuration

Most ordinary imported helpers are pure, so an unconditional call ban would be
too noisy. The rule needs trusted-module/function configuration and narrow
suppression. It must not imply that an allowlisted function is proven pure.

## Compiler boundary

Rejecting every opaque call would exclude normal React code, while accepting one
cannot reveal dependencies outside the analyzed function. Vidact therefore
documents the semantic risk and leaves the stricter policy to opt-in linting.
