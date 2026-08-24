import { Suspense, useState } from 'react'

import { CATEGORY_FILTERS, type CategoryFilter, type Product } from './model.ts'
import { ProductGridFallback, ProductResults } from './ProductGrid.tsx'

interface CatalogPanelProps {
  readonly productsPromise: PromiseLike<readonly Product[]>
  readonly loadProducts: (category: CategoryFilter) => Promise<readonly Product[]>
  readonly onAdd: (product: Product) => void
}

export function CatalogPanel({
  productsPromise,
  loadProducts,
  onAdd,
}: CatalogPanelProps): JSX.Element {
  const [catalogRequest, setCatalogRequest] = useState(productsPromise)
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [search, setSearch] = useState('')

  const chooseCategory = (nextCategory: CategoryFilter): void => {
    if (nextCategory === category) return
    setCategory(nextCategory)
    setCatalogRequest(loadProducts(nextCategory))
  }

  return (
    <div className="catalog-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">The collection</p>
          <h2 id="catalog-title">Everyday favorites</h2>
        </div>
        <label className="search-field">
          <span className="sr-only">Search products</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            placeholder="Search the collection"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="catalog-toolbar">
        <div className="category-filters" aria-label="Product categories">
          {CATEGORY_FILTERS.map((name) => (
            <button
              key={name}
              className={category === name ? 'selected' : ''}
              aria-pressed={category === name}
              onClick={() => chooseCategory(name)}
            >
              {name[0]?.toUpperCase()}
              {name.slice(1)}
            </button>
          ))}
        </div>
        <button
          className="refresh-button"
          onClick={() => setCatalogRequest(loadProducts(category))}
        >
          Refresh <span aria-hidden="true">↻</span>
        </button>
      </div>

      <Suspense fallback={<ProductGridFallback />}>
        <ProductResults productsPromise={catalogRequest} search={search} onAdd={onAdd} />
      </Suspense>
    </div>
  )
}
