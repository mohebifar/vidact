import { defineFileRoute, type RouteComponentProps } from '@vidact/start'

import { DocsSearch } from '@/components/docs-search.tsx'

export function RootLayout({ children }: RouteComponentProps<undefined>) {
  return (
    <>
      <DocsSearch />
      {children}
    </>
  )
}

export const Route = defineFileRoute({ component: RootLayout })
