import { use, useContext } from 'react'

import { CartContext } from './CartContext.tsx'
import { Badge } from './components/ui/badge.tsx'
import { Button } from './components/ui/button.tsx'
import { Card, CardContent, CardFooter } from './components/ui/card.tsx'
import { Skeleton } from './components/ui/skeleton.tsx'
import { productToneClassNames } from './lib/product-tones.ts'
import { cn } from './lib/utils.ts'
import { formatMoney, type Product } from './model.ts'

interface ProductResultsProps {
  readonly productsPromise: PromiseLike<readonly Product[]>
  readonly search: string
}

export function ProductResults({ productsPromise, search }: ProductResultsProps): JSX.Element {
  const cart = useContext(CartContext)
  if (cart === undefined) throw new Error('ProductResults must be rendered within a CartProvider')
  const products = use(productsPromise)
  const normalizedSearch = search.trim().toLowerCase()
  const visibleProducts = products.filter(
    (product) =>
      normalizedSearch === '' ||
      product.name.toLowerCase().includes(normalizedSearch) ||
      product.description.toLowerCase().includes(normalizedSearch),
  )

  return (
    <div data-shop-slot="product-results" data-product-count={visibleProducts.length}>
      <p className="mb-4 text-xs text-muted-foreground">
        {visibleProducts.length} {visibleProducts.length === 1 ? 'piece' : 'pieces'}
      </p>
      {visibleProducts.length === 0 ? (
        <Card className="grid min-h-96 place-items-center content-center gap-0 border-dashed bg-transparent py-10 text-center shadow-none ring-0">
          <span className="text-4xl text-muted-foreground" aria-hidden="true">
            ⌕
          </span>
          <h3 className="mt-2.5 font-heading text-xl tracking-tight">No pieces found</h3>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Try a different search or category.
          </p>
        </Card>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-x-4 gap-y-6 p-0 sm:grid-cols-2">
          {visibleProducts.map((product) => (
            <li key={product.id} className="min-w-0" data-product-card>
              <Card className="group/product gap-0 py-0 shadow-[4px_4px_0_color-mix(in_oklch,var(--foreground)_8%,transparent)]">
                <div
                  className={cn(
                    'relative grid aspect-[1.35] place-items-center overflow-hidden sm:aspect-[1.18]',
                    productToneClassNames[product.tone],
                  )}
                >
                  <span
                    className="pointer-events-none absolute -top-[40%] -right-[20%] aspect-square w-[78%] rounded-full border border-white/40"
                    aria-hidden="true"
                  />
                  <span
                    className="pointer-events-none absolute -bottom-[42%] -left-[12%] aspect-square w-[70%] rounded-full bg-white/15"
                    aria-hidden="true"
                  />
                  <Badge
                    className="absolute top-3 left-3 z-10 h-auto bg-white/70 px-2 py-1 text-[9px] font-bold tracking-[0.08em] uppercase backdrop-blur-sm"
                    variant="secondary"
                  >
                    {product.badge}
                  </Badge>
                  <span
                    className="relative z-10 rotate-[-4deg] font-serif text-[clamp(4.625rem,9vw,7.875rem)] leading-none font-normal drop-shadow-[0_22px_30px_rgb(37_39_33/0.13)] transition-transform duration-200 group-hover/product:rotate-0 group-hover/product:scale-105 motion-reduce:transition-none"
                    aria-hidden="true"
                  >
                    {product.icon}
                  </span>
                  <Button
                    className="absolute right-3 bottom-3 z-10 size-9 bg-background/90 text-xl transition-transform hover:rotate-90 hover:bg-primary hover:text-primary-foreground motion-reduce:transition-none"
                    size="icon"
                    variant="secondary"
                    aria-label={`Add ${product.name} to cart`}
                    onClick={() => cart.addToCart(product)}
                  >
                    +
                  </Button>
                </div>
                <CardContent className="p-4">
                  <div className="flex items-baseline justify-between gap-3 max-sm:grid">
                    <h3 className="font-heading text-lg tracking-tight sm:text-xl">
                      {product.name}
                    </h3>
                    <strong className="text-xs font-bold">{formatMoney(product.priceCents)}</strong>
                  </div>
                  <p className="mt-1.5 mb-3 min-h-0 text-xs leading-relaxed text-muted-foreground sm:min-h-10">
                    {product.description}
                  </p>
                </CardContent>
                <CardFooter className="p-0">
                  <Button className="min-h-10 w-full" onClick={() => cart.addToCart(product)}>
                    Add to cart
                  </Button>
                </CardFooter>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ProductGridFallback(): JSX.Element {
  return (
    <div data-shop-slot="product-results" aria-busy="true" aria-label="Loading products">
      <p className="mb-4 text-xs text-muted-foreground">Updating the collection…</p>
      <ul className="grid list-none grid-cols-1 gap-x-4 gap-y-6 p-0 sm:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <li key={index} className="min-w-0" data-product-card data-skeleton>
            <Card className="gap-0 py-0">
              <Skeleton className="aspect-[1.35] w-full sm:aspect-[1.18]" />
              <CardContent className="p-4">
                <Skeleton className="mb-3 h-5 w-[55%]" />
                <Skeleton className="mt-2 h-2.5 w-full" />
                <Skeleton className="mt-2 h-2.5 w-[68%]" />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
