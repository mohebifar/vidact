# Vidact documentation website

The user documentation for Vidact, built with Vidact Start, Fumadocs Core, and Tailwind CSS. Fumadocs
supplies the headless page tree and document lookup; the application shell and every component on the
page compile to Vidact without Fumadocs UI, Base UI, or React interop.

Documentation lives in `content/docs/**/*.mdx` and is organized the way React's and Solid's docs are:

- **Getting started**: introduction, quick start, installation.
- **Learn**: one concept per page, from "components run once" through state, events, forms, lists,
  effects, refs, context, error handling, and opt-in features.
- **Vidact Start**: the full-stack layer, from first route to deployment.
- **Guides**: migrating from React, testing, troubleshooting.
- **Reference**: each package's API, plus the React compatibility table.
- **Under the hood**: how compilation, reactivity, ownership, and server rendering work.

Page order within each section is defined in `src/lib/source.server.ts`.

## Authoring

Each page starts with `title`, `description`, and `group` frontmatter. Content before the first `##`
heading is the page introduction. The server parses MDX into serializable blocks and highlights code
with a narrowly configured Shiki instance; the browser renders those blocks with Vidact components.

Supported Markdown: paragraphs with inline code, bold, italics, and links; `##` and `###` headings;
ordered and unordered lists; tables; fenced code with an optional `title="..."`; and GitHub-style
callouts (`> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, optionally followed by a title on the same line).
Links that start with `/` use client-side navigation.

`<Preview variant="counter" />`, `toggle`, and `list` embed live compiled components.

## Development

```sh
pnpm --filter @vidact/example-docs dev
```

The development server listens on `http://127.0.0.1:5173` by default.
