import { vidact } from '@vidact/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vidact({ target: 'server', features: ['async', 'framework'] })],
  test: {
    include: ['src/**/*.server.test.ts'],
    environment: 'node',
  },
})
