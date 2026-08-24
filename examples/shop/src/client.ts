import { hydrateClientBoundaries, type ClientModuleLoader } from '@vidact/runtime/framework/hydrate'

import './style.css'

const host = document.querySelector<HTMLElement>('#shop-root')
if (host === null) throw new Error('The server-rendered shop shell is incomplete.')

const loadClientModule: ClientModuleLoader = async (reference) => {
  if (reference.id !== 'shop/ShopClient') {
    throw new Error(`Unknown shop client module ${reference.id}.`)
  }
  return import('./ShopClient.client.tsx')
}

const boundaries = await hydrateClientBoundaries(host, loadClientModule, {
  onRecoverableError: (error: unknown) =>
    console.error('Shop client boundary recovered from an error', error),
})

if (import.meta.hot !== undefined) {
  import.meta.hot.accept('./ShopClient.client.tsx', async () => {
    await boundaries.replace(loadClientModule)
  })
  import.meta.hot.dispose(() => boundaries.dispose())
}
