export async function loadLandingData() {
  if (!import.meta.env.SSR) throw new Error('Landing data is supplied by Vidact Start')
  return (await import('./landing.server.ts')).loadLandingRoute()
}
