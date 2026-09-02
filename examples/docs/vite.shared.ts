import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite'
import { vidactStart, type VidactStartOptions } from '@vidact/start/vite'

const compiler = {
  exclude: /[/\\]node_modules[/\\].*[/\\]fumadocs-core[/\\]/u,
  features: ['framework', 'css-insertion'],
} as const

export const docsResolve = {
  alias: {
    '@': fileURLToPath(new URL('./src', import.meta.url)),
  },
}

export function docsPlugins(options: VidactStartOptions = {}) {
  return [...vidactStart({ ...options, compiler }), tailwindcss(), wgslVitePlugin()]
}
