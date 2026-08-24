import { use } from 'react'

import { Badge } from './components/ui/badge.tsx'
import { Button } from './components/ui/button.tsx'
import { Card, CardContent, CardFooter } from './components/ui/card.tsx'
import { Skeleton } from './components/ui/skeleton.tsx'
import { formatMoney, type Product } from './model.ts'

interface ProductResultsProps {
  readonly productsPromise: PromiseLike<readonly Product[]>
  readonly search: string
  readonly onAdd: (product: Product) => void
}

export function ProductResults({
  productsPromise,
  search,
  onAdd,
}: ProductResultsProps): JSX.Element {
  const products = use(productsPromise)
  const normalizedSearch = search.trim().toLowerCase()
  const visibleProducts = products.filter(
    (product) =>
      normalizedSearch === '' ||
      product.name.toLowerCase().includes(normalizedSearch) ||
      product.description.toLowerCase().includes(normalizedSearch),
  )

  return (
    <div className="results" data-product-count={visibleProducts.length}>
      <p className="results-count">
        {visibleProducts.length} {visibleProducts.length === 1 ? 'piece' : 'pieces'}
      </p>
      {visibleProducts.length === 0 ? (
        <div className="empty-results">
          <span aria-hidden="true">⌕</span>
          <h3>No pieces found</h3>
          <p>Try a different search or category.</p>
        </div>
      ) : (
        <ul className="product-grid">
          {visibleProducts.map((product) => (
            <li key={product.id} className="product-card">
              <Card>
                <div className={`product-art tone-${product.tone}`}>
                  <Badge className="product-badge" variant="secondary">
                    {product.badge}
                  </Badge>
                  <span className="product-icon" aria-hidden="true">
                    {product.icon}
                  </span>
                  <Button
                    className="quick-add"
                    size="icon"
                    variant="secondary"
                    aria-label={`Add ${product.name} to cart`}
                    onClick={() => onAdd(product)}
                  >
                    +
                  </Button>
                </div>
                <CardContent className="product-copy">
                  <div>
                    <h3>{product.name}</h3>
                    <strong>{formatMoney(product.priceCents)}</strong>
                  </div>
                  <p>{product.description}</p>
                </CardContent>
                <CardFooter>
                  <Button className="add-to-cart" onClick={() => onAdd(product)}>
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
    <div className="results loading-results" aria-busy="true" aria-label="Loading products">
      <p className="results-count">Updating the collection…</p>
      <ul className="product-grid">
        {[0, 1, 2, 3].map((index) => (
          <li key={index} className="product-card skeleton-card">
            <Card>
              <Skeleton className="skeleton-art" />
              <CardContent className="product-copy">
                <Skeleton className="skeleton-title" />
                <Skeleton className="skeleton-line" />
                <Skeleton className="skeleton-line short" />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
