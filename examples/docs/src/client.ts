import { hydrateStart } from '@vidact/start/client'
import { routeManifest } from 'virtual:vidact-start/routes'

import './style.css'

const storedTheme = window.localStorage.getItem('vidact-theme')
if (
  storedTheme === 'dark' ||
  (storedTheme === null && window.matchMedia('(prefers-color-scheme: dark)').matches)
) {
  document.documentElement.classList.add('dark')
}

await hydrateStart({ manifest: routeManifest })
