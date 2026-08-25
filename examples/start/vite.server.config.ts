import { fileURLToPath } from 'node:url'

import { vidactStart } from '@vidact/start/vite'
import { defineConfig } from 'vite'

const serverEntry = fileURLToPath(new URL('./src/start.ts', import.meta.url))

export default defineConfig({
  plugins: [vidactStart({ serverEntry: false })],
  build: {
    ssr: serverEntry,
    outDir: 'dist/server',
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: 'start.js' },
    },
  },
})
