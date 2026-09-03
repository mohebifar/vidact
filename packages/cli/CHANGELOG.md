# vidact

## 0.2.0-beta.3

### Patch Changes

- 917f0be: Release vidact CLI

## 0.2.0-beta.2

### Minor Changes

- 9b7d659: Add the `vidact` project generator. `npx vidact my-app` scaffolds a runnable
  project from one of three templates: a Vite single-page app, a full-stack Vidact
  Start app with file routes, a loader, server rendering, and hydration, or that
  same full-stack app served by Nitro with a preset for every major deployment
  host. Prompts run on `@clack/prompts` and cancel cleanly on Ctrl+C or a closed
  stdin; package manager detection, installs, and the printed commands come from
  `nypm`, so npm, pnpm, yarn, bun, and deno are all spelled correctly.
