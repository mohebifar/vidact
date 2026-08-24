export type ProductCategory = 'home' | 'travel' | 'wear'
export type CategoryFilter = 'all' | ProductCategory
export type ProductTone = 'clay' | 'cream' | 'forest' | 'ink' | 'rose' | 'sun'

export interface Product {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly category: ProductCategory
  readonly priceCents: number
  readonly badge: string
  readonly icon: string
  readonly tone: ProductTone
}

export interface CartLine {
  readonly product: Product
  readonly quantity: number
}

export interface OrderReceipt {
  readonly orderId: string
  readonly itemCount: number
  readonly totalCents: number
  readonly estimatedDelivery: string
}

export const CATEGORY_FILTERS: readonly CategoryFilter[] = ['all', 'home', 'travel', 'wear']

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

export function cartQuantity(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0)
}

export function cartSubtotal(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => total + line.product.priceCents * line.quantity, 0)
}
