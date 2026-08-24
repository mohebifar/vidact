import { mountCompiled } from '@vidact/runtime/async'
import { readCompiledOwnerMetrics } from '@vidact/runtime/testing'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
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
    const baselineOwners = readCompiledOwnerMetrics().active
    const initial = deferred<readonly Product[]>()
    const travel = deferred<readonly Product[]>()
    const checkout = deferred<OrderReceipt>()
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
            return checkout.promise
          },
        }),
      host,
    ).dispose

    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
    initial.resolve([BOTTLE, CANDLE])
    await settle(initial.promise)
    expect(productNames(host)).toEqual(['Ridge Bottle', 'Ember Candle'])

    const shell = host.querySelector<HTMLElement>('.shop-shell')!
    const catalog = host.querySelector<HTMLElement>('.catalog-panel')!
    const cart = host.querySelector<HTMLElement>('.cart-panel')!
    const cartLink = host.querySelector<HTMLElement>('.cart-link')!
    const results = host.querySelector<HTMLElement>('.results')!
    const candleCard = productCard(host, 'Ember Candle')
    const bottleCardBeforeSearch = productCard(host, 'Ridge Bottle')!
    const bottleRemovalRules = subtreeMutationRules(bottleCardBeforeSearch, 'childList')
    const productGrid = bottleCardBeforeSearch.parentElement!
    const search = host.querySelector<HTMLInputElement>('.search-field input')!
    const searched = await captureMutations(host, () => userEvent.type(search, 'Ember'))
    expect(search.value).toBe('Ember')
    expect(document.activeElement).toBe(search)
    expect(productNames(host)).toEqual(['Ember Candle'])
    expect(host.querySelector('.shop-shell')).toBe(shell)
    expect(host.querySelector('.catalog-panel')).toBe(catalog)
    expect(host.querySelector('.cart-panel')).toBe(cart)
    expect(productCard(host, 'Ember Candle')).toBe(candleCard)
    expect(() =>
      assertMutationEnvelope(
        searched.records,
        [
          ...bottleRemovalRules,
          { type: 'childList', target: productGrid },
          { type: 'characterData', within: results },
          { type: 'attributes', target: results, attributeName: 'data-product-count' },
        ],
        'shop search',
      ),
    ).not.toThrow()

    const cleared = await captureMutations(host, () => userEvent.clear(search))
    expect(productNames(host)).toEqual(['Ridge Bottle', 'Ember Candle'])
    expect(productCard(host, 'Ember Candle')).toBe(candleCard)
    expect(() =>
      assertMutationEnvelope(
        cleared.records,
        [
          { type: 'childList', within: results },
          { type: 'characterData', within: results },
          { type: 'attributes', target: results, attributeName: 'data-product-count' },
        ],
        'shop search clear',
      ),
    ).not.toThrow()

    const bottleCard = productCard(host, 'Ridge Bottle')
    const emptyCheckout = host.querySelector<HTMLButtonElement>('.checkout-button')!
    const emptyCheckoutRemovalRules = subtreeMutationRules(emptyCheckout, 'childList')
    const added = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Add Ridge Bottle to cart"]')?.click(),
    )
    expect(host.querySelector('.cart-link')?.textContent).toContain('1')
    expect(host.querySelector('.cart-lines')?.textContent).toContain('Ridge Bottle')
    expect(host.querySelector('.cart-summary')?.textContent).toContain('$34.00')
    expect(productCard(host, 'Ridge Bottle')).toBe(bottleCard)
    expect(host.querySelector('.shop-shell')).toBe(shell)
    expect(() =>
      assertMutationEnvelope(
        added.records,
        [
          { type: 'characterData', within: cartLink },
          { type: 'childList', within: cart },
          ...emptyCheckoutRemovalRules,
          { type: 'characterData', within: cart },
          { type: 'attributes', within: cart },
        ],
        'add product to cart',
      ),
    ).not.toThrow()

    const cartLine = host.querySelector<HTMLElement>('.cart-lines li')!
    const incremented = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Add one Ridge Bottle"]')?.click(),
    )
    expect(host.querySelector('.cart-lines li')).toBe(cartLine)
    expect(cartLine.textContent).toContain('2')
    expect(host.querySelector('.cart-summary')?.textContent).toContain('$68.00')
    expect(() =>
      assertMutationEnvelope(
        incremented.records,
        [
          { type: 'characterData', within: cartLink },
          { type: 'characterData', within: cart },
        ],
        'increment cart quantity',
      ),
    ).not.toThrow()

    const categoryButtons = host.querySelectorAll<HTMLButtonElement>('.category-filters button')
    const resultsBeforeCategory = host.querySelector<HTMLElement>('.results')!
    const resultsRemovalRules = subtreeMutationRules(resultsBeforeCategory, 'childList')
    categoryButtons[2]?.focus()
    const selectedCategory = await captureMutations(host, () => userEvent.keyboard('{Enter}'))
    expect(loadedCategories).toEqual(['travel'])
    expect(categoryButtons[0]?.classList.contains('selected')).toBe(false)
    expect(categoryButtons[2]?.classList.contains('selected')).toBe(true)
    expect(categoryButtons[2]?.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(categoryButtons[2])
    expect(host.querySelector('.shop-shell')).toBe(shell)
    expect(host.querySelector('.catalog-panel')).toBe(catalog)
    expect(host.querySelector('.cart-panel')).toBe(cart)
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(() =>
      assertMutationEnvelope(
        selectedCategory.records,
        [
          { type: 'attributes', within: categoryButtons[0]?.parentElement ?? catalog },
          { type: 'childList', within: catalog },
          ...resultsRemovalRules,
        ],
        'select product category',
      ),
    ).not.toThrow()
    const loadingResults = host.querySelector<HTMLElement>('[aria-busy="true"]')!
    const loadingRemovalRules = subtreeMutationRules(loadingResults, 'childList')
    const revealed = await captureMutations(host, async () => {
      travel.resolve([BOTTLE])
      await settle(travel.promise)
    })
    expect(productNames(host)).toEqual(['Ridge Bottle'])
    expect(document.activeElement).toBe(categoryButtons[2])
    expect(() =>
      assertMutationEnvelope(
        revealed.records,
        [{ type: 'childList', within: catalog }, ...loadingRemovalRules],
        'reveal selected category',
      ),
    ).not.toThrow()

    const checkoutButton = host.querySelector<HTMLButtonElement>('.checkout-button')
    expect(checkoutButton).not.toBeNull()
    expect(checkoutButton?.disabled).toBe(false)
    const submitting = await captureMutations(host, async () => {
      checkoutButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(checkedOutQuantities).toEqual([2])
    expect(host.querySelector<HTMLButtonElement>('.checkout-button')?.disabled).toBe(true)
    expect(host.querySelector('.checkout-message')?.textContent).toContain('Placing your order')
    expect(() =>
      assertMutationEnvelope(
        submitting.records,
        [
          { type: 'childList', within: cart },
          { type: 'characterData', within: cart },
          { type: 'attributes', within: cart },
        ],
        'submit checkout',
      ),
    ).not.toThrow()

    checkout.resolve({
      orderId: 'NS-TEST123',
      itemCount: 2,
      totalCents: 6800,
      estimatedDelivery: 'tomorrow',
    })
    await settle(checkout.promise)
    expect(host.querySelector('.checkout-message')?.textContent).toContain('NS-TEST123')
    expect(host.querySelector('.cart-link')?.textContent).toContain('0')
    expect(host.querySelector('.shop-shell')).toBe(shell)
    expect(host.querySelector('.catalog-panel')).toBe(catalog)
    expect(host.querySelector('.cart-panel')).toBe(cart)

    dispose?.()
    dispose = undefined
    expect(readCompiledOwnerMetrics().active).toBe(baselineOwners)
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

function productCard(host: ParentNode, name: string): Element | undefined {
  return [...host.querySelectorAll('.product-card:not(.skeleton-card)')].find(
    (card) => card.querySelector('h3')?.textContent === name,
  )
}

function subtreeMutationRules(
  root: Element,
  type: MutationRecord['type'],
): { readonly type: MutationRecord['type']; readonly target: Node }[] {
  return [root, ...root.querySelectorAll('*')].map((target) => ({ type, target }))
}
