import { fileURLToPath } from 'node:url'

import { vidact } from '@vidact/vite'
import { defineConfig } from 'vite'

const clientEntry = fileURLToPath(new URL('./src/client.ts', import.meta.url))

export default defineConfig({
  plugins: [vidact({ target: 'hydrate', features: ['async', 'framework'] })],
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: clientEntry,
      output: {
        entryFileNames: 'assets/client.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (asset) =>
          asset.name?.endsWith('.css') === true ? 'assets/style.css' : 'assets/[name][extname]',
      },
    },
  },
})
