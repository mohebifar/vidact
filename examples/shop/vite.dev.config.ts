import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { vidact, type VidactPluginOptions } from '@vidact/vite'
import { NodeRequest, sendNodeResponse } from 'srvx/node'
import { defineConfig, isRunnableDevEnvironment, type Plugin, type ViteDevServer } from 'vite'

const DEVELOPMENT_ASSETS = {
  clientEntry: '/src/client.ts',
  stylesheet: '/src/style.css',
} as const
const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  appType: 'custom',
  resolve: { alias: { '@': sourceDirectory } },
  publicDir: 'public',
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 5173),
  },
  plugins: [
    tailwindcss(),
    vidactForEnvironment('client', {
      target: 'hydrate',
      features: ['async', 'framework', 'css-insertion', 'profiling'],
    }),
    vidactForEnvironment('ssr', {
      target: 'server',
      features: ['async', 'framework', 'css-insertion', 'profiling'],
    }),
    shopDevelopmentServer(),
  ],
})

function vidactForEnvironment(
  environmentName: 'client' | 'ssr',
  options: VidactPluginOptions,
): Plugin {
  const plugin = vidact(options)
  return {
    ...plugin,
    name: `${plugin.name}:${environmentName}`,
    applyToEnvironment: (environment) => environment.name === environmentName,
  }
}

function shopDevelopmentServer(): Plugin {
  return {
    name: 'vidact-shop-development-server',
    configureServer(server) {
      return () => {
        server.middlewares.use((request, response, next) => {
          void serveDevelopmentRequest(server, request, response).catch((error: unknown) => {
            if (error instanceof Error) server.ssrFixStacktrace(error)
            next(error)
          })
        })
      }
    },
  }
}

async function serveDevelopmentRequest(
  server: ViteDevServer,
  nodeRequest: IncomingMessage,
  nodeResponse: ServerResponse,
): Promise<void> {
  const environment = server.environments.ssr
  if (!isRunnableDevEnvironment(environment)) {
    throw new Error('The shop SSR environment must be runnable in development.')
  }
  const module = (await environment.runner.import('/src/server.ts')) as {
    readonly handleShopRequest: (
      request: Request,
      assets: typeof DEVELOPMENT_ASSETS,
    ) => Promise<Response>
  }
  const request = new NodeRequest({ req: nodeRequest, res: nodeResponse })
  let response = await module.handleShopRequest(request, DEVELOPMENT_ASSETS)

  if (response.headers.get('content-type')?.startsWith('text/html') === true) {
    const transformed = await server.transformIndexHtml(
      nodeRequest.url ?? '/',
      await response.text(),
    )
    response = new Response(transformed, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  await sendNodeResponse(nodeResponse, response)
}
