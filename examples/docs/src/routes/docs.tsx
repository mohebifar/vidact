import { defineFileRoute, type RouteComponentProps } from '@vidact/start'

import { DocsLayout } from '@/components/docs-layout.tsx'
import { loadDocsLayoutRoute } from '@/lib/docs-loader.ts'

export function DocsLayoutRoute({
  children,
  loaderData,
  requestUrl,
}: RouteComponentProps<Awaited<ReturnType<typeof loadDocsLayoutRoute>>>) {
  return (
    <DocsLayout children={children} navigation={loaderData.navigation} requestUrl={requestUrl} />
  )
}

export const Route = defineFileRoute({ loader: loadDocsLayoutRoute, component: DocsLayoutRoute })
