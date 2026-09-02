import { defineFileRoute, type RouteComponentProps, type RouteLoaderContext } from '@vidact/start'

import { DocsPage } from '@/components/docs-page.tsx'
import { loadDocRoute } from '@/lib/docs-loader.ts'

const loader = ({ params }: RouteLoaderContext) => loadDocRoute(params['*']?.split('/') ?? [])

export function DocsCatchallRoute({
  loaderData,
}: RouteComponentProps<Awaited<ReturnType<typeof loader>>>) {
  return <DocsPage page={loaderData} />
}

export const Route = defineFileRoute({ loader, component: DocsCatchallRoute })
