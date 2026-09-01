import { fileURLToPath } from 'node:url'

import { serve } from 'srvx/node'
import { staticMiddleware } from 'srvx/static'

import handler from './server.ts'

const server = serve({
  hostname: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 4173),
  silent: true,
  middleware: [staticMiddleware({ dir: fileURLToPath(new URL('../client', import.meta.url)) })],
  fetch: handler,
})

await server.ready()
console.log(`Vidact Docs is running at ${server.url}`)
