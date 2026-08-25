import { Suspense, useState } from 'react'

import { Button } from './components/ui/button.tsx'
import { Input } from './components/ui/input.tsx'
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group.tsx'
import { CATEGORY_FILTERS, type CategoryFilter, type Product } from './model.ts'
import { ProductGridFallback, ProductResults } from './ProductGrid.tsx'

interface CatalogPanelProps {
  readonly productsPromise: PromiseLike<readonly Product[]>
  readonly loadProducts: (category: CategoryFilter) => Promise<readonly Product[]>
}

export function CatalogPanel({ productsPromise, loadProducts }: CatalogPanelProps): JSX.Element {
  const [catalogRequest, setCatalogRequest] = useState(productsPromise)
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [search, setSearch] = useState('')

  const chooseCategory = (nextCategory: CategoryFilter): void => {
    if (nextCategory === category) return
    setCategory(nextCategory)
    setCatalogRequest(loadProducts(nextCategory))
  }

  return (
    <div
      className="overflow-hidden bg-card/95 text-card-foreground ring-1 ring-foreground/10 shadow-[8px_8px_0_color-mix(in_oklch,var(--foreground)_8%,transparent)] backdrop-blur-md"
      data-shop-slot="catalog-panel"
    >
      <div className="flex flex-col items-stretch justify-between gap-6 px-5 pt-6 sm:flex-row sm:items-end sm:px-8 sm:pt-8">
        <div>
          <p className="mb-3.5 text-[11px] font-bold tracking-[0.16em] uppercase">The collection</p>
          <h2
            className="font-heading text-[clamp(2.2rem,4vw,3.25rem)] leading-none font-semibold tracking-[-0.045em]"
            id="catalog-title"
          >
            Everyday favorites
          </h2>
        </div>
        <label className="relative flex w-full items-center text-muted-foreground focus-within:text-foreground sm:max-w-70">
          <span className="sr-only">Search products</span>
          <span className="pointer-events-none absolute left-3 text-base" aria-hidden="true">
            ⌕
          </span>
          <Input
            className="h-10 border-x-0 border-t-0 bg-transparent pr-2 pl-9 shadow-none focus-visible:ring-0"
            type="search"
            value={search}
            placeholder="Search the collection"
            onChange={(event) => setSearch(event.target.value)}
            data-shop-slot="catalog-search"
          />
        </label>
      </div>

      <div className="px-5 pb-6 sm:px-8 sm:pb-8">
        <div className="my-7 flex flex-col items-start justify-between gap-4 border-b pb-4 sm:flex-row sm:items-end">
          <ToggleGroup
            className="flex flex-wrap gap-1.5"
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
                    button.setAttribute('aria-pressed', String(button === event.currentTarget))
                  }
                  chooseCategory(name)
                }}
                className="border-transparent px-3 py-2 capitalize text-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                aria-pressed={category === name}
              >
                {name[0]?.toUpperCase()}
                {name.slice(1)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            className="gap-1.5 px-2 text-muted-foreground"
            variant="ghost"
            onClick={() => setCatalogRequest(loadProducts(category))}
          >
            Refresh <span aria-hidden="true">↻</span>
          </Button>
        </div>

        <Suspense fallback={<ProductGridFallback />}>
          <ProductResults productsPromise={catalogRequest} search={search} />
        </Suspense>
      </div>
    </div>
  )
}
