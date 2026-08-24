import { createResource, hydrateHotRoot, hydrateRoot } from '@vidact/runtime/async/hydrate'

import type { Product } from './model.ts'
import { ShopApp } from './ShopApp.tsx'

import './style.css'

interface InitialShopData {
  readonly products: readonly Product[]
}

const host = document.querySelector<HTMLElement>('#shop-root')
const data = document.querySelector<HTMLScriptElement>('#shop-data')
if (host === null || data === null) throw new Error('The server-rendered shop shell is incomplete.')

const initialData = JSON.parse(data.textContent ?? '') as InitialShopData
const productsPromise = Promise.resolve(initialData.products)

// Prewarm the client resource before hydration so its first render matches the
// fulfilled server tree and can claim every existing node without replacement.
createResource(productsPromise)
await productsPromise

const application = () => ShopApp({ productsPromise })
const options = {
  identifierPrefix: 'shop-',
  onRecoverableError: (error: unknown) =>
    console.error('Shop hydration recovered from an error', error),
}

if (import.meta.hot === undefined) {
  hydrateRoot(host, application, options)
} else {
  // Vite discovers self-accepting boundaries lexically in the application
  // module. The runtime helper owns root reuse, disposal, and pruning.
  import.meta.hot.accept()
  hydrateHotRoot(import.meta.hot, host, application, options)
}
