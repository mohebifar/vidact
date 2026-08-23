import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __VIDACT_DEV__: 'true',
  },
  test: {
    include: ['test/**/*.browser.test.ts', '../test-support/src/tests/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
