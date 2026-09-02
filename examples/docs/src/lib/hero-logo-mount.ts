/**
 * Lazily loads the vgpu crystal once `host` is on screen, keeping vgpu out
 * of the initial bundle. Lives in a plain .ts module because compiled
 * components cannot contain dynamic import expressions yet.
 */
export function mountHeroLogo(host: HTMLElement): () => void {
  let disposed = false
  let cleanup: (() => void) | undefined

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    observer.disconnect()
    void import('./hero-logo.ts').then(async ({ createHeroLogo }) => {
      const dispose = await createHeroLogo(host)
      if (disposed) dispose()
      else cleanup = dispose
    })
  })
  observer.observe(host)

  return () => {
    disposed = true
    observer.disconnect()
    cleanup?.()
  }
}
