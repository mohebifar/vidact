import { hydrateStart } from '@vidact/start/client'
import { routeManifest } from 'virtual:vidact-start/routes'

import { registerDocsTools, type DocsModelContext } from './lib/webmcp.ts'

import './style.css'

const storedTheme = window.localStorage.getItem('vidact-theme')
if (
  storedTheme === 'dark' ||
  (storedTheme === null && window.matchMedia('(prefers-color-scheme: dark)').matches)
) {
  document.documentElement.classList.add('dark')
}

const client = await hydrateStart({ manifest: routeManifest })
const removeTools = registerDocsTools(
  (document as Document & { modelContext?: DocsModelContext }).modelContext,
  (path) => client.navigate(path),
)
const pagehide = (event: PageTransitionEvent) => {
  if (!event.persisted) removeTools()
}
window.addEventListener('pagehide', pagehide)
import.meta.hot?.dispose(() => {
  removeTools()
  window.removeEventListener('pagehide', pagehide)
})
