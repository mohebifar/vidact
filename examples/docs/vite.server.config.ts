import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

import { docsPlugins, docsResolve } from './vite.shared.ts'

const serverEntry = fileURLToPath(new URL('./src/start.ts', import.meta.url))

export default defineConfig({
  plugins: docsPlugins({ serverEntry: false }),
  resolve: docsResolve,
  build: {
    ssr: serverEntry,
    outDir: 'dist/server',
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: 'start.js' },
    },
  },
})
