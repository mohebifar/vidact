import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  test: {
    environment: 'node',
    include: ['test/server/**/*.test.tsx'],
  },
})
