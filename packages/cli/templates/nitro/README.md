# {{projectName}}

A full-stack [Vidact Start](https://github.com/mohebifar/vidact) application served by
[Nitro](https://nitro.build), so it deploys to Node, Vercel, Netlify, Cloudflare, Deno Deploy, and
the rest of Nitro's presets from the same source.

## Commands

```sh
npm run dev        # start the Vite dev server
npm run build      # build the client, the server handler, and the Nitro output
npm start          # run the built Nitro server from .output/
npm run typecheck  # type-check the project
```

## Deploying

`npm run build` produces a Node server in `.output/`. Pick another target with a preset:

```sh
NITRO_PRESET=vercel npm run build
NITRO_PRESET=cloudflare_module npm run build
NITRO_PRESET=netlify npm run build
```

See [Nitro's deployment providers](https://nitro.build/deploy) for the full list.

## Layout

```
src/routes/           file routes; every file becomes a route
src/routes/__root.tsx the layout wrapping every route
src/server.ts         the request handler and document shell
src/client.ts         hydration entry
server/routes/        the Nitro catch-all that hands requests to Vidact Start
nitro.config.ts       Nitro configuration, including where the client build lives
```

The build runs in three steps: Vite compiles the browser bundle into `dist/client`, Vite compiles
the server handler into `dist/server/handler.js`, and Nitro wraps that handler in a deployable
server. Only the last step changes when you change deployment targets.

## Routing

A file under `src/routes` becomes a route: `about.tsx` serves `/about`, `products/$id.tsx` serves
`/products/:id`, and `index.tsx` serves the directory itself. Export a `loader` from a route to
fetch its data on the server before the component renders.

Server-only endpoints can also live in `server/routes` as ordinary Nitro handlers; anything Nitro
does not match falls through to Vidact Start.
