import { installHydration } from './hydration.ts'

installHydration()

export * from './index.ts'
export { createReactElement as createElement } from './renderable.ts'
export { hydrateHotRoot, hydrateRoot } from './root.ts'
