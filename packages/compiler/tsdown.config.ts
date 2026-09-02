import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'node',
  unbundle: true,
  fixedExtension: false,
  sourcemap: true,
  // Sources ship in the package, so maps point at them instead of embedding a copy.
  outputOptions: { sourcemapExcludeSources: true },
  dts: true,
  // The native addon and its declarations are emitted into dist by napi, so the
  // JavaScript build cleans only its own output and never bundles the binding.
  clean: ['dist/index.*'],
  deps: { neverBundle: [/binding\.js$/] },
  tsconfig: './tsconfig.build.json',
})
