import { Alert, AlertDescription } from './components/ui/alert.tsx'
import { Badge } from './components/ui/badge.tsx'
import { Button } from './components/ui/button.tsx'
import { cartQuantity, cartSubtotal, formatMoney, type CartLine } from './model.ts'
import type { CheckoutState } from './ShopApp.tsx'

interface CartPanelProps {
  readonly cart: readonly CartLine[]
  readonly checkoutState: CheckoutState
  readonly onChangeQuantity: (productId: string, change: number) => void
  readonly onCheckout: () => void
}

export function CartPanel({
  cart,
  checkoutState,
  onChangeQuantity,
  onCheckout,
}: CartPanelProps): JSX.Element {
  const itemCount = cartQuantity(cart)
  const subtotal = cartSubtotal(cart)

  return (
    <aside className="cart-panel" id="cart" aria-labelledby="cart-title">
      <div className="cart-heading">
        <div>
          <p className="eyebrow">Your basket</p>
          <h2 id="cart-title">Cart</h2>
        </div>
        <Badge className="cart-count">{itemCount}</Badge>
      </div>

      {cart.length === 0 && (
        <div className="empty-cart">
          <span aria-hidden="true">◇</span>
          <p>Your cart is ready for something good.</p>
          <a href="#catalog">Browse the collection</a>
        </div>
      )}
      {cart.length > 0 && (
        <ul className="cart-lines">
          {cart.map((line) => (
            <li key={line.product.id}>
              <span className={`cart-product-icon tone-${line.product.tone}`} aria-hidden="true">
                {line.product.icon}
              </span>
              <div className="cart-product-copy">
                <strong>{line.product.name}</strong>
                <span>{formatMoney(line.product.priceCents)}</span>
                <div className="quantity-control" aria-label={`Quantity for ${line.product.name}`}>
                  <Button
                    size="icon-xs"
                    variant="outline"
                    aria-label={`Remove one ${line.product.name}`}
                    onClick={() => onChangeQuantity(line.product.id, -1)}
                  >
                    −
                  </Button>
                  <span>{line.quantity}</span>
                  <Button
                    size="icon-xs"
                    variant="outline"
                    aria-label={`Add one ${line.product.name}`}
                    onClick={() => onChangeQuantity(line.product.id, 1)}
                  >
                    +
                  </Button>
                </div>
              </div>
              <strong className="line-total">
                {formatMoney(line.product.priceCents * line.quantity)}
              </strong>
            </li>
          ))}
        </ul>
      )}

      <div className="cart-summary">
        <div>
          <span>Subtotal</span>
          <strong>{formatMoney(subtotal)}</strong>
        </div>
        <p>Taxes and shipping calculated at checkout.</p>
        {cart.length === 0 ? (
          <Button className="checkout-button" size="lg" disabled onClick={onCheckout}>
            Checkout
          </Button>
        ) : checkoutState.status === 'submitting' ? (
          <Button className="checkout-button" size="lg" disabled onClick={onCheckout}>
            Placing order…
          </Button>
        ) : (
          <Button className="checkout-button" size="lg" onClick={onCheckout}>
            Checkout
          </Button>
        )}
        {checkoutState.message !== '' && (
          <Alert
            className={`checkout-message ${checkoutState.status}`}
            variant={checkoutState.status === 'error' ? 'destructive' : 'default'}
            role="status"
            aria-live="polite"
          >
            <AlertDescription>{checkoutState.message}</AlertDescription>
          </Alert>
        )}
      </div>
    </aside>
  )
}
