# Vidact examples

Examples are executable integration corpora. They use workspace packages rather
than checked-in generated output, so development and production builds exercise
the same compiler adapter.

| Example | Command | Coverage |
| --- | --- | --- |
| [TodoMVC](./todomvc/) | `pnpm dev:todomvc` | Rust analysis, OXC JSX lowering, hooks, arrays, events, and direct DOM rendering |
| [Shop](./shop/) | `pnpm dev:shop` | Async data, server rendering, hydration, and cart state |
| [Docs](./docs/) | `pnpm dev:docs` | Tailwind, client navigation, and MDX compiled through Vidact |
| [Start](./start/) | `pnpm dev:start` | File routes, nested layouts, loaders, endpoints, SSR, and hydration |
