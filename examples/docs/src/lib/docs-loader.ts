export async function loadDocsLayoutRoute() {
  if (!import.meta.env.SSR) throw new Error('Documentation navigation is supplied by Vidact Start')
  return (await import('./source.server.ts')).loadDocsNavigation()
}

export async function loadDocRoute(slugs: readonly string[]) {
  if (!import.meta.env.SSR) throw new Error('Documentation content is supplied by Vidact Start')
  return (await import('./source.server.ts')).loadDocPage(slugs)
}
