import { defineFileRoute, type RouteComponentProps } from '@vidact/start'

export function RootLayout({ children }: RouteComponentProps<undefined>) {
  return <>{children}</>
}

export const Route = defineFileRoute({ component: RootLayout })
