import { installHydration } from './hydration.ts'

installHydration()

export * from './actions.ts'
export { hydrateHotRoot, hydrateRoot } from './root.ts'
