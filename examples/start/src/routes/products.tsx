import { defineFileRoute, type RouteComponentProps } from '@vidact/start'

export function ProductsLayout({ children }: RouteComponentProps<undefined>): JSX.Element {
  return <main className="product-layout">{children}</main>
}

export const Route = defineFileRoute({ component: ProductsLayout })
