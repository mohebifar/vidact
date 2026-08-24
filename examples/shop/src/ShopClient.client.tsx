'use client'

import { createResource } from '@vidact/runtime/async/hydrate'
import { defineClientBoundary } from '@vidact/runtime/framework/hydrate'

import type { Product } from './model.ts'
import { ShopApp } from './ShopApp.tsx'

interface ShopClientProps {
  readonly products: readonly Product[]
}

interface PreparedShopClient {
  readonly productsPromise: PromiseLike<readonly Product[]>
}

function ShopClient(props: PreparedShopClient): JSX.Element {
  return <ShopApp productsPromise={props.productsPromise} />
}

export const shop = defineClientBoundary(
  (_props: ShopClientProps, prepared: PreparedShopClient) => ShopClient(prepared),
  async (props) => {
    if (!Array.isArray(props.products))
      throw new TypeError('Shop client products must be an array.')
    const productsPromise = Promise.resolve(props.products)
    createResource(productsPromise)
    await productsPromise
    return { productsPromise }
  },
)
