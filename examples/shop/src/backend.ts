import { CATALOG, listProducts } from './catalog.ts'
import {
  cartQuantity,
  cartSubtotal,
  type CartLine,
  type CategoryFilter,
  type OrderReceipt,
} from './model.ts'

const CATEGORIES = new Set<CategoryFilter>(['all', 'home', 'travel', 'wear'])

export async function handleApiRequest(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url)

  if (request.method === 'GET' && url.pathname === '/api/products') {
    const requestedCategory = url.searchParams.get('category') ?? 'all'
    if (!CATEGORIES.has(requestedCategory as CategoryFilter)) {
      return json({ error: 'Unknown product category.' }, 400)
    }
    const products = await listProducts(requestedCategory as CategoryFilter)
    return json({ products })
  }

  if (request.method === 'POST' && url.pathname === '/api/checkout') {
    const payload = await readJson(request)
    const lines = parseCheckoutLines(payload)
    if (lines.length === 0) return json({ error: 'Your cart is empty.' }, 400)

    await new Promise((resolve) => setTimeout(resolve, 420))
    const receipt: OrderReceipt = {
      orderId: `NS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      itemCount: cartQuantity(lines),
      totalCents: cartSubtotal(lines),
      estimatedDelivery: '3–5 business days',
    }
    return json(receipt, 201)
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json({ status: 'ok' })
  }

  return undefined
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

function parseCheckoutLines(payload: unknown): CartLine[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return []
  const lines: CartLine[] = []
  for (const item of payload.items) {
    if (!isRecord(item) || typeof item.productId !== 'string') continue
    const quantity = Number(item.quantity)
    const product = CATALOG.find((candidate) => candidate.id === item.productId)
    if (product === undefined || !Number.isInteger(quantity) || quantity < 1 || quantity > 10)
      continue
    lines.push({ product, quantity })
  }
  return lines
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
