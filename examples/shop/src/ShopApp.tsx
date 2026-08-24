import { useState } from 'react'

import { CartPanel } from './CartPanel.tsx'
import { CatalogPanel } from './CatalogPanel.tsx'
import { Badge } from './components/ui/badge.tsx'
import { buttonVariants } from './components/ui/button.tsx'
import { Card, CardContent } from './components/ui/card.tsx'
import { cn } from './lib/utils.ts'
import {
  cartQuantity,
  type CartLine,
  type CategoryFilter,
  type OrderReceipt,
  type Product,
} from './model.ts'

export interface ShopAppProps {
  readonly productsPromise: PromiseLike<readonly Product[]>
  readonly loadProducts?: (category: CategoryFilter) => Promise<readonly Product[]>
  readonly submitOrder?: (lines: readonly CartLine[]) => Promise<OrderReceipt>
}

export interface CheckoutState {
  readonly status: 'idle' | 'submitting' | 'complete' | 'error'
  readonly message: string
}

export function ShopApp({
  productsPromise,
  loadProducts = fetchProducts,
  submitOrder = checkout,
}: ShopAppProps): JSX.Element {
  const [cart, setCart] = useState<CartLine[]>([])
  const [checkoutState, setCheckoutState] = useState<CheckoutState>({
    status: 'idle',
    message: '',
  })
  const itemCount = cartQuantity(cart)

  const addToCart = (product: Product): void => {
    setCheckoutState({ status: 'idle', message: '' })
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id)
      if (existing === undefined) return [...current, { product, quantity: 1 }]
      return current.map((line) =>
        line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
      )
    })
  }

  const changeQuantity = (productId: string, change: number): void => {
    setCart((current) =>
      current
        .map((line) =>
          line.product.id === productId
            ? { ...line, quantity: Math.max(0, line.quantity + change) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    )
  }

  const placeOrder = async (): Promise<void> => {
    if (cart.length === 0 || checkoutState.status === 'submitting') return
    setCheckoutState({ status: 'submitting', message: 'Placing your order…' })
    try {
      const receipt = await submitOrder(cart)
      setCart([])
      setCheckoutState({
        status: 'complete',
        message: `Order ${receipt.orderId} confirmed · ${receipt.estimatedDelivery}`,
      })
    } catch (error) {
      setCheckoutState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Checkout failed. Please try again.',
      })
    }
  }

  return (
    <div className="shop-shell" data-vidact-example="shop">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Northstar Supply home">
          <span className="brand-mark">N</span>
          <span>Northstar Supply</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#catalog">Shop</a>
          <a href="#story">Our story</a>
        </nav>
        <a
          className={cn(buttonVariants({ variant: 'ghost' }), 'cart-link')}
          href="#cart"
          aria-label="Cart"
        >
          Cart <Badge>{itemCount}</Badge>
        </a>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <img src="/shop-hero.png" alt="A bottle, candle, canvas tote, and travel pouch" />
          <div className="hero-copy">
            <p className="eyebrow">Considered goods for daily rituals</p>
            <h1 id="hero-title">Less, but better.</h1>
            <p>
              Useful objects with honest materials, calm colors, and enough character to keep
              around.
            </p>
            <a className={cn(buttonVariants({ size: 'lg' }), 'primary-link')} href="#catalog">
              Explore the collection <span aria-hidden="true">→</span>
            </a>
          </div>
          <p className="hero-note">Free shipping on orders over $75</p>
        </section>

        <section className="shop-layout" id="catalog" aria-labelledby="catalog-title">
          <CatalogPanel
            productsPromise={productsPromise}
            loadProducts={loadProducts}
            onAdd={addToCart}
          />

          <CartPanel
            cart={cart}
            checkoutState={checkoutState}
            onChangeQuantity={changeQuantity}
            onCheckout={placeOrder}
          />
        </section>

        <section className="story" id="story">
          <p className="eyebrow">Why Northstar</p>
          <div>
            <h2>Objects should earn their place.</h2>
            <p>
              We work with small makers and responsible factories to create versatile goods,
              avoiding trend cycles and unnecessary packaging.
            </p>
          </div>
          <dl className="story-values">
            <Card size="sm">
              <CardContent>
                <dt>01</dt>
                <dd>Useful by design</dd>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardContent>
                <dt>02</dt>
                <dd>Lower-impact materials</dd>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardContent>
                <dt>03</dt>
                <dd>Made to be kept</dd>
              </CardContent>
            </Card>
          </dl>
        </section>
      </main>

      <footer className="site-footer">
        <span>Northstar Supply</span>
        <span>Server Components + Suspense + surgical hydration by Vidact</span>
        <span>© 2026</span>
      </footer>
    </div>
  )
}

async function fetchProducts(category: CategoryFilter): Promise<readonly Product[]> {
  const response = await fetch(`/api/products?category=${encodeURIComponent(category)}`)
  if (!response.ok) throw new Error('The collection could not be refreshed.')
  const payload = (await response.json()) as { readonly products: readonly Product[] }
  return payload.products
}

async function checkout(lines: readonly CartLine[]): Promise<OrderReceipt> {
  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: lines.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
      })),
    }),
  })
  const payload = (await response.json()) as OrderReceipt & { readonly error?: string }
  if (!response.ok) throw new Error(payload.error ?? 'Checkout failed. Please try again.')
  return payload
}
