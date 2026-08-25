import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { vidact } from '@vidact/vite'
import { defineConfig } from 'vite'

const clientEntry = fileURLToPath(new URL('./src/client.ts', import.meta.url))
const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: { alias: { '@': sourceDirectory } },
  plugins: [
    tailwindcss(),
    vidact({
      target: 'hydrate',
      features: ['async', 'framework', 'css-insertion', 'profiling'],
    }),
  ],
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
