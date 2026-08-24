# @vidact/compiler

Native Node-API bindings for the Vidact React-to-Vanilla compiler.

```ts
import { compile } from '@vidact/compiler'

const result = await compile(source, {
  filename: '/src/App.tsx',
  target: 'client',
  features: [],
})
```

`compile` and `analyze` run compiler work outside the JavaScript thread.
Synchronous variants are available for small scripts and the packaged `vidactc`
command. The package installs a prebuilt addon for the supported operating
system, architecture, and libc; consumers do not need Rust or Cargo.
