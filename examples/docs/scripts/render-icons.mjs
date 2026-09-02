/**
 * Bakes the hero crystal into the static images the site needs: the header mark
 * and the favicons. Rendering happens headlessly through Dawn (`vgpu/node`), so
 * no browser and no GPU are needed at build or deploy time. The PNGs are
 * committed; run `pnpm render:icons` after changing the logo or its material.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PNG } from 'pngjs'
import { init } from 'vgpu/node'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const publicDirectory = path.join(root, 'public')

/**
 * Every size the document head and the header ask for, in both surfaces: the
 * default is the dark crystal for light pages, and `-dark` is the exposed one
 * for dark pages and dark browser chrome.
 */
const sizes = [
  { name: 'favicon-32', size: 32 },
  { name: 'favicon-48', size: 48 },
  { name: 'apple-touch-icon', size: 180 },
  { name: 'logo-64', size: 64 },
  { name: 'logo-128', size: 128 },
  { name: 'logo-512', size: 512 },
]
const icons = sizes.flatMap(({ name, size }) => [
  { name: `${name}.png`, size, surface: 'light' },
  { name: `${name}-dark.png`, size, surface: 'dark' },
])

// Vite resolves the WGSL imports, the `@/` alias, and TypeScript for the shared
// scene module, so the icon renders from the same source the hero uses.
const server = await createServer({
  configFile: path.join(root, 'vite.config.ts'),
  logLevel: 'warn',
  root,
  server: { middlewareMode: true },
})

try {
  const { renderCrystalIcon } = await server.ssrLoadModule('/src/lib/hero/icon.ts')
  const glb = (await readFile(path.join(root, 'src/assets/logo.glb'))).buffer
  const gpu = await init()
  console.log(`rendering on ${gpu.adapter.name}`)

  try {
    await mkdir(publicDirectory, { recursive: true })
    // oxlint-disable no-await-in-loop -- One device renders one icon at a time.
    for (const { name, size, surface } of icons) {
      // Oversample, then box-filter down: the crystal's edge lines are one pixel
      // wide, and at 32 pixels they alias badly without it.
      const scale = size <= 128 ? 4 : 2
      const rendered = await renderCrystalIcon(gpu, { glb, size: size * scale, surface })
      const pixels = downsample(rendered.pixels, size * scale, scale)
      const png = new PNG({ width: size, height: size })
      png.data.set(pixels)
      await writeFile(path.join(publicDirectory, name), PNG.sync.write(png))
      console.log(`  public/${name} (${size}x${size}, rendered at ${size * scale})`)
    }
  } finally {
    gpu.dispose()
  }
} finally {
  await server.close()
}

/** Averages each `factor` x `factor` block of straight-alpha RGBA. */
function downsample(pixels, sourceSize, factor) {
  if (factor === 1) return pixels
  const size = sourceSize / factor
  const out = new Uint8Array(size * size * 4)
  const samples = factor * factor
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const index = ((y * factor + dy) * sourceSize + x * factor + dx) * 4
          const alpha = pixels[index + 3]
          // Weight color by coverage so transparent pixels do not wash the edge.
          r += pixels[index] * alpha
          g += pixels[index + 1] * alpha
          b += pixels[index + 2] * alpha
          a += alpha
        }
      }
      const target = (y * size + x) * 4
      out[target] = a === 0 ? 0 : Math.round(r / a)
      out[target + 1] = a === 0 ? 0 : Math.round(g / a)
      out[target + 2] = a === 0 ? 0 : Math.round(b / a)
      out[target + 3] = Math.round(a / samples)
    }
  }
  return out
}
