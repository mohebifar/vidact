import { defineFileRoute, type RouteComponentProps } from '@vidact/start'

import { DocsPage } from '@/components/docs-page.tsx'
import { loadDocRoute } from '@/lib/docs-loader.ts'

const loader = () => loadDocRoute([])

export function DocsIndexRoute({
  loaderData,
}: RouteComponentProps<Awaited<ReturnType<typeof loader>>>) {
  return <DocsPage page={loaderData} />
}

export const Route = defineFileRoute({ loader, component: DocsIndexRoute })
