# {{projectName}}

A full-stack application built with [Vidact Start](https://github.com/mohebifar/vidact): file
routes, server loaders, server rendering, and hydration from one generated manifest.

## Commands

```sh
npm run dev        # start the dev server
npm run build      # build the client and server bundles into dist/
npm start          # run the production server from dist/
npm run typecheck  # type-check the project
```

## Layout

```
src/routes/           file routes; every file becomes a route
src/routes/__root.tsx the layout wrapping every route
src/server.ts         the request handler and document shell
src/client.ts         hydration entry
src/start.ts          the production Node server
```

## Routing

A file under `src/routes` becomes a route: `about.tsx` serves `/about`, `products/$id.tsx` serves
`/products/:id`, and `index.tsx` serves the directory itself. Export a `loader` from a route to
fetch its data on the server before the component renders.
