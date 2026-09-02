# {{projectName}}

A single-page application compiled by [Vidact](https://github.com/mohebifar/vidact). Components are
written as React and compiled to direct DOM operations, so no virtual DOM ships to the browser.

## Commands

```sh
npm run dev        # start the dev server
npm run build      # build for production into dist/
npm run preview    # preview the production build
npm run typecheck  # type-check the project
```

## Layout

```
index.html        document shell
src/main.ts       mounts the compiled root component
src/App.tsx       the root component
src/style.css     styles
vite.config.ts    Vite with the Vidact plugin
```
