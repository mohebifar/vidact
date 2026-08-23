import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __VIDACT_DEV__: 'true',
    __VIDACT_RETAINED_UI__: 'false',
    __VIDACT_UNSAFE_HTML__: 'false',
  },
  test: {
    include: ['test/lifecycle/activity.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
})
