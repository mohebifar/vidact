'use server'

import {
  createClientBoundary,
  createClientModuleManifest,
  createClientReference,
  type FrameworkValue,
} from '@vidact/runtime/framework/server'

import type { Product } from './model.ts'
import { ShopApp } from './ShopApp.tsx'

interface ShopPageProps {
  readonly products: readonly Product[]
  readonly productsPromise: PromiseLike<readonly Product[]>
}

const shopClientManifest = createClientModuleManifest({
  'shop/ShopClient': ['shop'],
})
const shopClientReference = createClientReference('shop/ShopClient', 'shop')

export function ShopPage({ products, productsPromise }: ShopPageProps): JSX.Element {
  return createClientBoundary(
    shopClientReference,
    { products } as unknown as FrameworkValue,
    <ShopApp productsPromise={productsPromise} />,
    {
      clientManifest: shopClientManifest,
      hostProps: { 'data-server-component': 'shop-page' },
    },
  )
}
