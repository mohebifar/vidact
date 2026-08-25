import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { vidact } from '@vidact/vite'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: { alias: { '@': sourceDirectory } },
  plugins: [
    tailwindcss(),
    vidact({ features: ['async', 'framework', 'css-insertion', 'profiling'] }),
  ],
  test: {
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
