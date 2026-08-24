import { fileURLToPath } from 'node:url'

import { serve } from 'srvx/node'
import { staticMiddleware } from 'srvx/static'

import { handleShopRequest } from './server.ts'

const port = Number(process.env.PORT ?? 4173)
const hostname = process.env.HOST ?? '127.0.0.1'
const clientDirectory = fileURLToPath(new URL('../client', import.meta.url))

const server = serve({
  port,
  hostname,
  silent: true,
  middleware: [staticMiddleware({ dir: clientDirectory })],
  fetch: handleShopRequest,
})

await server.ready()
console.log(`Northstar Supply is running at ${server.url}`)
