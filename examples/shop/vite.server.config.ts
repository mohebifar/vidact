import { fileURLToPath } from 'node:url'

import { vidact } from '@vidact/vite'
import { defineConfig } from 'vite'

const serverEntry = fileURLToPath(new URL('./src/start.ts', import.meta.url))
const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: { alias: { '@': sourceDirectory } },
  plugins: [
    vidact({
      target: 'server',
      features: ['async', 'framework', 'css-insertion', 'profiling'],
    }),
  ],
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
