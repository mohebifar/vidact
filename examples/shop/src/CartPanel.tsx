import { useContext } from 'react'

import { CartContext } from './CartContext.tsx'
import { Alert, AlertDescription } from './components/ui/alert.tsx'
import { Badge } from './components/ui/badge.tsx'
import { Button, buttonVariants } from './components/ui/button.tsx'
import { productToneClassNames } from './lib/product-tones.ts'
import { cn } from './lib/utils.ts'
import { formatMoney } from './model.ts'

export function CartPanel(): JSX.Element {
  const context = useContext(CartContext)
  if (context === undefined) throw new Error('CartPanel must be rendered within a CartProvider')

  return (
    <aside
      className="lg:sticky lg:top-6"
      id="cart"
      aria-labelledby="cart-title"
      data-shop-slot="cart-panel"
    >
      <div className="overflow-hidden bg-card/95 text-card-foreground ring-1 ring-foreground/10 shadow-[8px_8px_0_color-mix(in_oklch,var(--foreground)_8%,transparent)] backdrop-blur-md">
        <div className="flex flex-row items-start justify-between border-b px-5 py-6 sm:px-7">
          <div>
            <p className="mb-3.5 text-[11px] font-bold tracking-[0.16em] uppercase">Your basket</p>
            <h2 className="font-heading text-4xl leading-none font-semibold" id="cart-title">
              Cart
            </h2>
          </div>
          <Badge className="grid h-7 min-w-7 place-items-center rounded-full px-2 text-[11px]">
            {context.itemCount}
          </Badge>
        </div>

        {context.cart.length === 0 && (
          <div
            className="grid min-h-64 place-items-center content-center px-6 text-center text-muted-foreground"
            data-shop-slot="empty-cart"
          >
            <span
              className="grid size-15 place-items-center rounded-full border text-2xl"
              aria-hidden="true"
            >
              ◇
            </span>
            <p className="mt-4 mb-2 max-w-52 font-serif text-lg">
              Your cart is ready for something good.
            </p>
            <a
              className={cn(
                buttonVariants({ variant: 'link', size: 'sm' }),
                'text-[11px] font-bold tracking-[0.06em] uppercase',
              )}
              href="#catalog"
            >
              Browse the collection
            </a>
          </div>
        )}
        {context.cart.length > 0 && (
          <div className="px-5 sm:px-7">
            <ul
              className="max-h-[430px] list-none overflow-auto py-2 lg:block"
              data-shop-slot="cart-lines"
            >
              {context.cart.map((line) => (
                <li
                  className="grid grid-cols-[54px_minmax(0,1fr)_auto] items-start gap-3 border-b py-4"
                  key={line.product.id}
                >
                  <span
                    className={cn(
                      'grid h-15.5 w-13.5 place-items-center font-heading text-2xl',
                      productToneClassNames[line.product.tone],
                    )}
                    aria-hidden="true"
                  >
                    {line.product.icon}
                  </span>
                  <div className="grid">
                    <strong className="font-heading text-sm font-normal">
                      {line.product.name}
                    </strong>
                    <span className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatMoney(line.product.priceCents)}
                    </span>
                    <div
                      className="mt-2 grid w-max grid-cols-[24px_25px_24px] items-center border text-center"
                      aria-label={`Quantity for ${line.product.name}`}
                    >
                      <Button
                        className="border-0"
                        size="icon-xs"
                        variant="outline"
                        aria-label={`Remove one ${line.product.name}`}
                        onClick={() => context.changeQuantity(line.product.id, -1)}
                      >
                        −
                      </Button>
                      <span className="text-[11px]">{line.quantity}</span>
                      <Button
                        className="border-0"
                        size="icon-xs"
                        variant="outline"
                        aria-label={`Add one ${line.product.name}`}
                        onClick={() => context.changeQuantity(line.product.id, 1)}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                  <strong className="pt-0.5 text-xs">
                    {formatMoney(line.product.priceCents * line.quantity)}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div
          className="flex flex-col items-stretch border-t px-5 py-5 sm:px-7"
          data-shop-slot="cart-summary"
        >
          <div className="flex justify-between font-heading text-lg">
            <span>Subtotal</span>
            <strong className="font-normal">{formatMoney(context.subtotal)}</strong>
          </div>
          <p className="mt-1.5 mb-4 text-[10px] text-muted-foreground">
            Taxes and shipping calculated at checkout.
          </p>
          {context.cart.length === 0 ? (
            <Button
              className="h-auto w-full py-3.5 text-xs font-bold tracking-[0.06em] uppercase"
              data-shop-slot="checkout-button"
              size="lg"
              disabled
              onClick={context.placeOrder}
            >
              Checkout
            </Button>
          ) : context.checkoutState.status === 'submitting' ? (
            <Button
              className="h-auto w-full py-3.5 text-xs font-bold tracking-[0.06em] uppercase"
              data-shop-slot="checkout-button"
              size="lg"
              disabled
              onClick={context.placeOrder}
            >
              Placing order…
            </Button>
          ) : (
            <Button
              className="h-auto w-full py-3.5 text-xs font-bold tracking-[0.06em] uppercase"
              data-shop-slot="checkout-button"
              size="lg"
              onClick={async (event) => {
                const button = event.currentTarget
                button.disabled = true
                await context.placeOrder()
                if (
                  button.isConnected &&
                  button
                    .closest('[data-shop-slot="cart-panel"]')
                    ?.querySelector('[data-checkout-status="error"]')
                ) {
                  button.disabled = false
                }
              }}
            >
              Checkout
            </Button>
          )}
          {context.checkoutState.message !== '' && (
            <Alert
              className="mt-3 min-h-8"
              data-shop-slot="checkout-message"
              data-checkout-status={context.checkoutState.status}
              variant={context.checkoutState.status === 'error' ? 'destructive' : 'default'}
              role="status"
              aria-live="polite"
            >
              <AlertDescription>{context.checkoutState.message}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </aside>
  )
}
