import { useContext } from 'react'

import { CartContext, CartProvider } from './CartContext.tsx'
import { CartPanel } from './CartPanel.tsx'
import { CatalogPanel } from './CatalogPanel.tsx'
import { Badge } from './components/ui/badge.tsx'
import { buttonVariants } from './components/ui/button.tsx'
import { Card, CardContent } from './components/ui/card.tsx'
import { cn } from './lib/utils.ts'
import { type CartLine, type CategoryFilter, type OrderReceipt, type Product } from './model.ts'

export interface ShopAppProps {
  readonly productsPromise: PromiseLike<readonly Product[]>
  readonly loadProducts?: (category: CategoryFilter) => Promise<readonly Product[]>
  readonly submitOrder?: (lines: readonly CartLine[]) => Promise<OrderReceipt>
}

interface ShopLayoutProps {
  readonly productsPromise: PromiseLike<readonly Product[]>
  readonly loadProducts: (category: CategoryFilter) => Promise<readonly Product[]>
}

export function ShopApp({
  productsPromise,
  loadProducts = fetchProducts,
  submitOrder = checkout,
}: ShopAppProps): JSX.Element {
  return (
    <CartProvider submitOrder={submitOrder}>
      <ShopLayout productsPromise={productsPromise} loadProducts={loadProducts} />
    </CartProvider>
  )
}

function ShopLayout({ productsPromise, loadProducts }: ShopLayoutProps): JSX.Element {
  return (
    <div
      className="min-h-screen bg-background bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:64px_64px]"
      data-vidact-example="shop"
    >
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-6 sm:px-8 sm:pb-8">
        <header className="relative z-10 grid min-h-18 grid-cols-[1fr_auto] items-center border-b bg-background/90 backdrop-blur-md md:min-h-22 md:grid-cols-[1fr_auto_1fr]">
          <a
            className="inline-flex items-center justify-self-start gap-2.5 text-sm font-bold tracking-[0.08em] uppercase no-underline"
            href="#top"
            aria-label="Northstar Supply home"
          >
            <span className="grid size-8.5 place-items-center border border-primary bg-primary text-base italic text-primary-foreground">
              N
            </span>
            <span className="hidden sm:inline">Northstar Supply</span>
          </a>
          <nav className="hidden gap-8 md:flex" aria-label="Primary navigation">
            <a
              className="relative text-sm font-medium text-muted-foreground no-underline after:absolute after:inset-x-0 after:-bottom-1.5 after:h-px after:origin-center after:scale-x-0 after:bg-current after:transition-transform hover:text-foreground hover:after:scale-x-100 focus-visible:text-foreground focus-visible:after:scale-x-100 motion-reduce:after:transition-none"
              href="#catalog"
            >
              Shop
            </a>
            <a
              className="relative text-sm font-medium text-muted-foreground no-underline after:absolute after:inset-x-0 after:-bottom-1.5 after:h-px after:origin-center after:scale-x-0 after:bg-current after:transition-transform hover:text-foreground hover:after:scale-x-100 focus-visible:text-foreground focus-visible:after:scale-x-100 motion-reduce:after:transition-none"
              href="#story"
            >
              Our story
            </a>
          </nav>
          <CartLink />
        </header>

        <main id="top">
          <section
            className="relative mt-4 min-h-[610px] overflow-hidden border bg-[#d9b180] md:mt-6 md:min-h-[620px]"
            aria-labelledby="hero-title"
          >
            <img
              className="absolute inset-0 size-full object-cover object-[66%_center] saturate-[0.68] contrast-[1.04] md:object-center"
              src="/shop-hero.png"
              alt="A bottle, candle, canvas tote, and travel pouch"
            />
            <div
              className="pointer-events-none absolute inset-0 bg-linear-to-b from-[#e2bf91]/25 to-[#291f17]/50 md:bg-gradient-to-r md:from-[#332519]/20 md:to-transparent md:to-60%"
              aria-hidden="true"
            />
            <div className="absolute bottom-8 z-10 w-full p-7 text-white md:relative md:bottom-auto md:w-[min(48%,580px)] md:p-0 md:pt-26 md:pb-20 md:pl-18 md:text-[#33281f]">
              <p className="mb-3.5 text-[11px] font-bold tracking-[0.16em] uppercase">
                Considered goods for daily rituals
              </p>
              <h1
                className="max-w-155 font-heading text-[clamp(3.625rem,20vw,5.125rem)] leading-[0.9] font-semibold tracking-[-0.08em] md:text-[clamp(4rem,7vw,6.75rem)]"
                id="hero-title"
              >
                Less, but better.
              </h1>
              <p className="my-5 max-w-[440px] text-[15px] leading-relaxed md:my-7 md:text-lg">
                Useful objects with honest materials, calm colors, and enough character to keep
                around.
              </p>
              <a
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'h-auto gap-7 px-5 py-3.5 text-xs font-bold tracking-[0.04em] uppercase transition-all hover:gap-9 motion-reduce:transition-none',
                )}
                href="#catalog"
              >
                Explore the collection
                <span aria-hidden="true">→</span>
              </a>
            </div>
            <Badge
              className="absolute top-4 right-4 z-20 h-auto border-white/60 bg-white/75 px-3 py-2 text-[10px] font-semibold tracking-[0.06em] text-[#33281f] uppercase backdrop-blur-md md:top-auto md:right-7 md:bottom-6"
              variant="outline"
            >
              Free shipping on orders over $75
            </Badge>
          </section>

          <section
            className="grid items-start gap-6 py-18 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-27"
            id="catalog"
            aria-labelledby="catalog-title"
          >
            <CatalogPanel productsPromise={productsPromise} loadProducts={loadProducts} />

            <CartPanel />
          </section>

          <section
            className="grid items-start gap-7 border-y px-1.5 py-18 md:grid-cols-[0.4fr_1.2fr] md:px-8 lg:grid-cols-[0.55fr_1.35fr_1fr] lg:gap-12 lg:py-25"
            id="story"
          >
            <p className="text-[11px] font-bold tracking-[0.16em] uppercase">Why Northstar</p>
            <div>
              <h2 className="max-w-[560px] font-heading text-[clamp(2.875rem,5vw,4.5rem)] leading-[0.98] font-semibold tracking-[-0.045em]">
                Objects should earn their place.
              </h2>
              <p className="mt-6 max-w-[610px] text-base leading-[1.7] text-muted-foreground">
                We work with small makers and responsible factories to create versatile goods,
                avoiding trend cycles and unnecessary packaging.
              </p>
            </div>
            <dl className="m-0 md:col-start-2 lg:col-start-auto">
              <Card className="gap-0 bg-transparent py-0 shadow-none ring-0" size="sm">
                <CardContent className="grid grid-cols-[42px_1fr] border-b px-0 py-4">
                  <dt className="text-[11px] text-muted-foreground">01</dt>
                  <dd className="m-0 font-heading text-base">Useful by design</dd>
                </CardContent>
              </Card>
              <Card className="gap-0 bg-transparent py-0 shadow-none ring-0" size="sm">
                <CardContent className="grid grid-cols-[42px_1fr] border-b px-0 py-4">
                  <dt className="text-[11px] text-muted-foreground">02</dt>
                  <dd className="m-0 font-heading text-base">Lower-impact materials</dd>
                </CardContent>
              </Card>
              <Card className="gap-0 bg-transparent py-0 shadow-none ring-0" size="sm">
                <CardContent className="grid grid-cols-[42px_1fr] border-b px-0 py-4">
                  <dt className="text-[11px] text-muted-foreground">03</dt>
                  <dd className="m-0 font-heading text-base">Made to be kept</dd>
                </CardContent>
              </Card>
            </dl>
          </section>
        </main>

        <footer className="grid gap-2 pt-8 text-[11px] text-muted-foreground md:grid-cols-[1fr_auto_1fr] md:gap-6">
          <span>Northstar Supply</span>
          <span className="md:text-center">
            Server Components + Suspense + surgical hydration by Vidact
          </span>
          <span className="md:text-right">© 2026</span>
        </footer>
      </div>
    </div>
  )
}

function CartLink(): JSX.Element {
  const cart = useContext(CartContext)
  if (cart === undefined) throw new Error('CartLink must be rendered within a CartProvider')

  return (
    <a
      className={cn(
        buttonVariants({ variant: 'ghost' }),
        'justify-self-end gap-2 px-0 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground',
      )}
      href="#cart"
      aria-label="Cart"
      data-shop-slot="cart-link"
    >
      Cart
      <Badge className="grid h-7 min-w-7 place-items-center rounded-full px-2 text-[11px]">
        {cart.itemCount}
      </Badge>
    </a>
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
