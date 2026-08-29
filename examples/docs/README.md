# Vidact docs starter

A minimal Fumadocs-style documentation shell built from the official shadcn Base
UI registry and compiled to Vidact's direct DOM runtime.

This is not a port of `fumadocs-ui`. The production entry imports all 35 modules
that currently produce a React-free bundle. Button, Input, published Base UI
Collapsible, and the local Popover have browser interaction plus stable-owner
proof. Popover replaces the
copied Base UI wrapper without patching the dependency and uses one owner-aware
root subscription. The docs shell also mounts Alert, Card, Kbd, and Separator
statically. Avatar mounts under its provider, while its reactive image-status
path remains build-only. `src/shadcn-compatibility.ts` records these distinctions
for the 35 React-free modules and the first known boundary for the other 26
registry components.

```sh
pnpm --filter @vidact/example-docs dev
pnpm --filter @vidact/example-docs test
pnpm --filter @vidact/example-docs build
pnpm --filter @vidact/example-docs audit:shadcn
```

The build finishes by scanning every emitted JavaScript bundle and fails if it
finds a React package import, React element tag, React DOM renderer, or compat
adapter.
