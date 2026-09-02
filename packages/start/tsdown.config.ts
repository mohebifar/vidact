import { defineConfig } from 'tsdown'

const shared = {
  platform: 'node',
  unbundle: true,
  fixedExtension: false,
  sourcemap: true,
  // Sources ship in the package, so maps point at them instead of embedding a copy.
  outputOptions: { sourcemapExcludeSources: true },
  tsconfig: './tsconfig.build.json',
} as const

export default defineConfig([
  {
    ...shared,
    entry: ['src/**/*.ts', '!src/virtual.ts'],
    dts: true,
  },
  {
    // The virtual route module is an ambient declaration. Bundling its types would
    // turn it into a module augmentation of a specifier that only exists at build
    // time, so it ships as written next to an empty runtime module.
    ...shared,
    entry: ['src/virtual.ts'],
    dts: false,
    clean: false,
    copy: [{ from: 'src/virtual.ts', to: 'dist', rename: 'virtual.d.ts' }],
  },
])
