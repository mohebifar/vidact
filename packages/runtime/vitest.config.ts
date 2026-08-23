import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __VIDACT_DEV__: 'true',
    __VIDACT_UNSAFE_HTML__: 'true',
  },
  test: {
    setupFiles: ['test/setup-browser.ts'],
    include: ['test/**/*.browser.test.ts', '../test-support/src/tests/**/*.browser.test.ts'],
    exclude: ['test/lifecycle/activity.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
})
