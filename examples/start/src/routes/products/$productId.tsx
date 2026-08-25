import {
  defineFileRoute,
  Link,
  type RouteComponentProps,
  type RouteLoaderContext,
} from '@vidact/start'

const loader = ({ params }: RouteLoaderContext) => ({
  productId: params.productId,
  requestId: crypto.randomUUID(),
})

export function ProductRoute({
  loaderData,
  params,
}: RouteComponentProps<ReturnType<typeof loader>>): JSX.Element {
  return (
    <article className="product-card">
      <p className="eyebrow">Dynamic route parameter</p>
      <h1>{params.productId}</h1>
      <p>
        The loader received <code>{loaderData.productId}</code> and produced request{' '}
        <code>{loaderData.requestId}</code>.
      </p>
      <Link href="/">Back home</Link>
    </article>
  )
}

export const Route = defineFileRoute({ loader, component: ProductRoute })
