import { defineConfig } from 'vitest/config'

import { docsPlugins, docsResolve } from './vite.shared.ts'

export default defineConfig({
  plugins: docsPlugins({ serverEntry: false }),
  resolve: docsResolve,
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
