import type { CategoryFilter, Product } from './model.ts'

export const CATALOG: readonly Product[] = [
  {
    id: 'ridge-bottle',
    name: 'Ridge Bottle',
    description: 'Double-wall steel with a soft-touch finish for everyday carry.',
    category: 'travel',
    priceCents: 3400,
    badge: 'Bestseller',
    icon: '↟',
    tone: 'cream',
  },
  {
    id: 'weekender-tote',
    name: 'Weekender Tote',
    description: 'Washed canvas, generous pockets, and handles that sit comfortably.',
    category: 'travel',
    priceCents: 4800,
    badge: 'New',
    icon: '⌒',
    tone: 'clay',
  },
  {
    id: 'ember-candle',
    name: 'Ember Candle',
    description: 'Cedar, black tea, and bergamot poured into reusable amber glass.',
    category: 'home',
    priceCents: 2800,
    badge: 'Small batch',
    icon: '✦',
    tone: 'sun',
  },
  {
    id: 'arc-tray',
    name: 'Arc Catchall',
    description: 'A hand-finished stoneware tray for the pieces you reach for daily.',
    category: 'home',
    priceCents: 3600,
    badge: 'Handmade',
    icon: '◒',
    tone: 'rose',
  },
  {
    id: 'field-cap',
    name: 'Field Cap',
    description: 'Lightweight organic twill with an unstructured, easy fit.',
    category: 'wear',
    priceCents: 3200,
    badge: 'Organic cotton',
    icon: '⌁',
    tone: 'forest',
  },
  {
    id: 'studio-socks',
    name: 'Studio Socks',
    description: 'Cushioned rib-knit socks made for long walks and slow mornings.',
    category: 'wear',
    priceCents: 1800,
    badge: 'Two-pack',
    icon: '≈',
    tone: 'ink',
  },
]

export async function listProducts(
  category: CategoryFilter = 'all',
  delayMilliseconds = 280,
): Promise<readonly Product[]> {
  if (delayMilliseconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMilliseconds))
  }
  return category === 'all' ? CATALOG : CATALOG.filter((product) => product.category === category)
}
