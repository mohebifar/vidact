import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/**/*.ts'],
  platform: 'neutral',
  unbundle: true,
  fixedExtension: false,
  sourcemap: true,
  // Sources ship in the package, so maps point at them instead of embedding a copy.
  outputOptions: { sourcemapExcludeSources: true },
  dts: true,
  copy: ['src/env.d.ts'],
  tsconfig: './tsconfig.build.json',
})
