import { fileURLToPath } from 'node:url'

export interface TemplateDefinition {
  readonly name: string
  readonly title: string
  readonly description: string
}

export const templates: readonly TemplateDefinition[] = [
  {
    name: 'spa',
    title: 'Single-page app',
    description: 'Vite, the Vidact compiler plugin, and a client-rendered entry point.',
  },
  {
    name: 'start',
    title: 'Full-stack app',
    description: 'Vidact Start with file routes, loaders, server rendering, and hydration.',
  },
  {
    name: 'nitro',
    title: 'Full-stack app on Nitro',
    description: 'Vidact Start served by Nitro, with deployment presets for every major host.',
  },
]

export const defaultTemplate = 'spa'

export const templatesDirectory = fileURLToPath(new URL('../templates/', import.meta.url))

export function findTemplate(name: string): TemplateDefinition | undefined {
  return templates.find((template) => template.name === name)
}

export function templateNames(): readonly string[] {
  return templates.map((template) => template.name)
}
