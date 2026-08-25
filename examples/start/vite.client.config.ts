import { fileURLToPath } from 'node:url'

import { vidactStart } from '@vidact/start/vite'
import { defineConfig } from 'vite'

const clientEntry = fileURLToPath(new URL('./src/client.ts', import.meta.url))

export default defineConfig({
  plugins: [vidactStart({ serverEntry: false })],
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
