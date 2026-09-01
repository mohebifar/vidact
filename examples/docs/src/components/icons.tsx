type IconProps = { readonly className?: string }

export function MenuIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="2"
      />
    </svg>
  )
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M20.3 15.1A8.5 8.5 0 0 1 8.9 3.7 8.5 8.5 0 1 0 20.3 15Z"
        stroke="currentColor"
        stroke-linejoin="round"
        stroke-width="1.8"
      />
    </svg>
  )
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8" />
      <path
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.8"
      />
    </svg>
  )
}

export function ArrowIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.8"
      />
    </svg>
  )
}
