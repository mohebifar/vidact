import { fileURLToPath } from 'node:url'

import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

import clientConfig from './vite.client.config.ts'
import { docsPlugins, docsResolve } from './vite.shared.ts'

export default defineConfig({
  plugins: [
    nitro({
      preset: process.env.NITRO_PRESET ?? 'vercel',
      compatibilityDate: '2026-09-02',
      serverDir: false,
      serverEntry: false,
      // The docs use Shiki's JavaScript engine, not its native WASM exports.
      wasm: false,
      // Asset filenames are stable, so clients must revalidate after a deployment.
      routeRules: {
        '/assets/**': { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
      },
      vercel: { functions: { runtime: 'nodejs24.x' } },
    }),
    ...docsPlugins({ serverEntry: false }),
  ],
  resolve: docsResolve,
  environments: {
    client: { build: clientConfig.build ?? {} },
    ssr: {
      build: {
        rollupOptions: {
          input: fileURLToPath(new URL('./src/nitro.ts', import.meta.url)),
        },
      },
    },
  },
})
