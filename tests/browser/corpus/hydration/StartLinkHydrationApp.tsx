import { Link } from '../../../../packages/start/src/link-client.ts'

function SearchIcon() {
  return (
    <svg aria-hidden="true" data-search-icon="" viewBox="0 0 24 24">
      <circle cx="10.5" cy="10.5" r="6.5" />
    </svg>
  )
}

export function StartLinkHydrationApp() {
  return (
    <nav>
      <Link href="/docs">Docs</Link>
      <SearchIcon />
    </nav>
  )
}
