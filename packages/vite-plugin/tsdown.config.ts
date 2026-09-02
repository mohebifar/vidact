import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/**/*.ts'],
  platform: 'node',
  unbundle: true,
  fixedExtension: false,
  sourcemap: true,
  // Sources ship in the package, so maps point at them instead of embedding a copy.
  outputOptions: { sourcemapExcludeSources: true },
  dts: true,
  tsconfig: './tsconfig.build.json',
})
