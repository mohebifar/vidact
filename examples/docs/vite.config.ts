import mdx from '@mdx-js/rollup'
import tailwindcss from '@tailwindcss/vite'
import { vidact } from '@vidact/vite'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    { ...mdx({ jsx: true }), enforce: 'pre' },
    vidact({ extensions: ['.tsx', '.mdx'] }),
    tailwindcss(),
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
