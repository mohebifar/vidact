# Vidact documentation website

The user documentation for Vidact, organized with the Diátaxis framework and built with Vidact
Start, Fumadocs Core, and Tailwind CSS. Fumadocs supplies the headless page tree and document
lookup. The application shell and local components compile to Vidact without Fumadocs UI, Base
UI, or React interop.

The site contains learning-oriented tutorials, task-focused how-to guides, public API reference,
and explanations of Vidact's compilation, reactivity, ownership, and framework model.
Documentation lives in `content/docs/**/*.mdx`. The server parses MDX into serializable blocks and
uses a narrowly configured Shiki instance for syntax tokens; the browser renders those blocks with
Vidact-owned components.

```sh
pnpm --filter @vidact/example-docs dev
```

The development server listens on `http://127.0.0.1:5173` by default.
