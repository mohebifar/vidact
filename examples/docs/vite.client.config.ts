import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

import { docsPlugins, docsResolve } from './vite.shared.ts'

const clientEntry = fileURLToPath(new URL('./src/client.ts', import.meta.url))

export default defineConfig({
  plugins: docsPlugins({ serverEntry: false }),
  resolve: docsResolve,
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
