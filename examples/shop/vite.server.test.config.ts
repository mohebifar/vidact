import { fileURLToPath } from 'node:url'

import { vidact } from '@vidact/vite'
import { defineConfig } from 'vitest/config'

const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: { alias: { '@': sourceDirectory } },
  plugins: [
    vidact({
      target: 'server',
      features: ['async', 'framework', 'css-insertion', 'profiling'],
    }),
  ],
  test: {
    include: ['src/**/*.server.test.ts'],
    environment: 'node',
  },
})
