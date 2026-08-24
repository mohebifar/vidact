import { fileURLToPath } from 'node:url'

import { vidact } from '@vidact/vite'
import { defineConfig } from 'vite'

const serverEntry = fileURLToPath(new URL('./src/start.ts', import.meta.url))

export default defineConfig({
  plugins: [vidact({ target: 'server', features: ['async', 'framework'] })],
  build: {
    ssr: serverEntry,
    outDir: 'dist/server',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'server.js',
      },
    },
  },
})
