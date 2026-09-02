import { fileURLToPath } from 'node:url'

import { defineNitroConfig } from 'nitropack/config'

export default defineNitroConfig({
  compatibilityDate: '2026-01-01',
  srcDir: 'server',
  alias: {
    'vidact-start-handler': fileURLToPath(new URL('./dist/server/handler.js', import.meta.url)),
  },
  // The client build stays a Vite artifact; Nitro serves and deploys it as static assets.
  publicAssets: [
    {
      dir: fileURLToPath(new URL('./dist/client', import.meta.url)),
      baseURL: '/',
      maxAge: 60 * 60 * 24 * 365,
    },
  ],
})
