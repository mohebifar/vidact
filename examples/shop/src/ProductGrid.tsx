import { use } from 'react'

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
              <div className={`product-art tone-${product.tone}`}>
                <span className="product-badge">{product.badge}</span>
                <span className="product-icon" aria-hidden="true">
                  {product.icon}
                </span>
                <button
                  className="quick-add"
                  aria-label={`Add ${product.name} to cart`}
                  onClick={() => onAdd(product)}
                >
                  +
                </button>
              </div>
              <div className="product-copy">
                <div>
                  <h3>{product.name}</h3>
                  <strong>{formatMoney(product.priceCents)}</strong>
                </div>
                <p>{product.description}</p>
                <button onClick={() => onAdd(product)}>Add to cart</button>
              </div>
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
            <div className="skeleton skeleton-art" />
            <div className="product-copy">
              <span className="skeleton skeleton-title" />
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line short" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
