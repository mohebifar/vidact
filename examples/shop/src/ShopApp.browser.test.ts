import { mountCompiled } from '@vidact/runtime/async'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

import type { CategoryFilter, OrderReceipt, Product } from './model.ts'
import { ShopApp } from './ShopApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('Vidact shop', () => {
  it('reveals suspended products, refetches categories, manages the cart, and checks out', async () => {
    const initial = deferred<readonly Product[]>()
    const travel = deferred<readonly Product[]>()
    const loadedCategories: CategoryFilter[] = []
    const checkedOutQuantities: number[] = []
    const host = document.createElement('div')
    document.body.appendChild(host)

    dispose = mountCompiled(
      () =>
        ShopApp({
          productsPromise: initial.promise,
          loadProducts: (category) => {
            loadedCategories.push(category)
            return travel.promise
          },
          submitOrder: async (lines) => {
            checkedOutQuantities.push(lines.reduce((total, line) => total + line.quantity, 0))
            return {
              orderId: 'NS-TEST123',
              itemCount: 1,
              totalCents: 3400,
              estimatedDelivery: 'tomorrow',
            } satisfies OrderReceipt
          },
        }),
      host,
    ).dispose

    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
    initial.resolve([BOTTLE, CANDLE])
    await settle(initial.promise)
    expect(productNames(host)).toEqual(['Ridge Bottle', 'Ember Candle'])

    const search = host.querySelector<HTMLInputElement>('.search-field input')!
    await userEvent.type(search, 'Ember')
    expect(search.value).toBe('Ember')
    expect(productNames(host)).toEqual(['Ember Candle'])
    await userEvent.clear(search)
    expect(productNames(host)).toEqual(['Ridge Bottle', 'Ember Candle'])

    host.querySelector<HTMLButtonElement>('[aria-label="Add Ridge Bottle to cart"]')?.click()
    expect(host.querySelector('.cart-link')?.textContent).toContain('1')
    expect(host.querySelector('.cart-lines')?.textContent).toContain('Ridge Bottle')
    expect(host.querySelector('.cart-summary')?.textContent).toContain('$34.00')

    const categoryButtons = host.querySelectorAll<HTMLButtonElement>('.category-filters button')
    categoryButtons[2]?.click()
    expect(loadedCategories).toEqual(['travel'])
    expect(categoryButtons[0]?.classList.contains('selected')).toBe(false)
    expect(categoryButtons[2]?.classList.contains('selected')).toBe(true)
    expect(categoryButtons[2]?.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
    travel.resolve([BOTTLE])
    await settle(travel.promise)
    expect(productNames(host)).toEqual(['Ridge Bottle'])

    const checkoutButton = host.querySelector<HTMLButtonElement>('.checkout-button')
    expect(checkoutButton).not.toBeNull()
    expect(checkoutButton?.disabled).toBe(false)
    checkoutButton?.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(checkedOutQuantities).toEqual([1])
    expect(host.querySelector('.checkout-message')?.textContent).toContain('NS-TEST123')
    expect(host.querySelector('.cart-link')?.textContent).toContain('0')
  })
})

const BOTTLE: Product = {
  id: 'ridge-bottle',
  name: 'Ridge Bottle',
  description: 'Double-wall steel bottle.',
  category: 'travel',
  priceCents: 3400,
  badge: 'Bestseller',
  icon: '↟',
  tone: 'cream',
}

const CANDLE: Product = {
  id: 'ember-candle',
  name: 'Ember Candle',
  description: 'Cedar and black tea candle.',
  category: 'home',
  priceCents: 2800,
  badge: 'Small batch',
  icon: '✦',
  tone: 'sun',
}

function deferred<Value>(): {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value) => void
} {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function settle(promise: PromiseLike<unknown>): Promise<void> {
  await promise
  await Promise.resolve()
  await Promise.resolve()
}

function productNames(host: ParentNode): string[] {
  return [...host.querySelectorAll('.product-card:not(.skeleton-card) h3')].map(
    (heading) => heading.textContent ?? '',
  )
}
