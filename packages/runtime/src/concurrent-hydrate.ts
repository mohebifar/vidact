import { installHydration } from './hydration.ts'

installHydration()

export * from './concurrent.ts'
export { hydrateHotRoot, hydrateRoot } from './root.ts'
