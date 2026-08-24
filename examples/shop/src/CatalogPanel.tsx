import { Suspense, useState } from 'react'

import { Button } from './components/ui/button.tsx'
import { Input } from './components/ui/input.tsx'
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group.tsx'
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
          <Input
            type="search"
            value={search}
            placeholder="Search the collection"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="catalog-toolbar">
        <ToggleGroup
          className="category-filters"
          aria-label="Product categories"
          value={[category]}
          onValueChange={(values) => {
            const nextCategory = values[0]
            if (nextCategory !== undefined) chooseCategory(nextCategory as CategoryFilter)
          }}
          spacing={0}
          variant="outline"
        >
          {CATEGORY_FILTERS.map((name) => (
            <ToggleGroupItem
              key={name}
              value={name}
              variant="outline"
              onClick={(event) => {
                const group = event.currentTarget.parentElement
                for (const button of group?.querySelectorAll('button') ?? []) {
                  const selected = button === event.currentTarget
                  button.classList.toggle('selected', selected)
                  button.setAttribute('aria-pressed', String(selected))
                }
                chooseCategory(name)
              }}
              className={category === name ? 'selected' : ''}
              aria-pressed={category === name}
            >
              {name[0]?.toUpperCase()}
              {name.slice(1)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          className="refresh-button"
          variant="ghost"
          onClick={() => setCatalogRequest(loadProducts(category))}
        >
          Refresh <span aria-hidden="true">↻</span>
        </Button>
      </div>

      <Suspense fallback={<ProductGridFallback />}>
        <ProductResults productsPromise={catalogRequest} search={search} onAdd={onAdd} />
      </Suspense>
    </div>
  )
}
