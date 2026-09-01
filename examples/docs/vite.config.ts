import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { docsPlugins, docsResolve } from './vite.shared.ts'

export default defineConfig({
  plugins: docsPlugins(),
  resolve: docsResolve,
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 5173),
  },
  ssr: {
    noExternal: [],
  },
  test: {
    include: ['src/**/*.browser.test.{ts,tsx}'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
