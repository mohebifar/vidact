import { createContext, useState } from 'react'

import {
  cartQuantity,
  cartSubtotal,
  type CartLine,
  type OrderReceipt,
  type Product,
} from './model.ts'

export interface CheckoutState {
  readonly status: 'idle' | 'submitting' | 'complete' | 'error'
  readonly message: string
}

export interface CartContextValue {
  readonly cart: readonly CartLine[]
  readonly checkoutState: CheckoutState
  readonly itemCount: number
  readonly subtotal: number
  readonly addToCart: (product: Product) => void
  readonly changeQuantity: (productId: string, change: number) => void
  readonly placeOrder: () => Promise<void>
}

interface CartProviderProps {
  readonly children: JSX.Element
  readonly submitOrder: (lines: readonly CartLine[]) => Promise<OrderReceipt>
}

export const CartContext = createContext<CartContextValue | undefined>(undefined)

export function CartProvider({ children, submitOrder }: CartProviderProps): JSX.Element {
  const [cart, setCart] = useState<CartLine[]>([])
  const [checkoutState, setCheckoutState] = useState<CheckoutState>({
    status: 'idle',
    message: '',
  })

  const addToCart = (product: Product): void => {
    setCheckoutState({ status: 'idle', message: '' })
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id)
      if (existing === undefined) return [...current, { product, quantity: 1 }]
      return current.map((line) =>
        line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
      )
    })
  }

  const changeQuantity = (productId: string, change: number): void => {
    setCart((current) =>
      current
        .map((line) =>
          line.product.id === productId
            ? { ...line, quantity: Math.max(0, line.quantity + change) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    )
  }

  const placeOrder = async (): Promise<void> => {
    if (cart.length === 0 || checkoutState.status === 'submitting') return
    setCheckoutState({ status: 'submitting', message: 'Placing your order…' })
    try {
      const receipt = await submitOrder(cart)
      setCart([])
      setCheckoutState({
        status: 'complete',
        message: `Order ${receipt.orderId} confirmed · ${receipt.estimatedDelivery}`,
      })
    } catch (error) {
      setCheckoutState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Checkout failed. Please try again.',
      })
    }
  }

  return (
    <CartContext.Provider
      value={{
        cart,
        checkoutState,
        itemCount: cartQuantity(cart),
        subtotal: cartSubtotal(cart),
        addToCart,
        changeQuantity,
        placeOrder,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}
