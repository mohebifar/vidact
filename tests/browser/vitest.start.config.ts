import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['corpus/apps/start-navigation/StartLayoutRetention.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
})
