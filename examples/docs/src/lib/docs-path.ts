/** Accept only local documentation paths, including a destination heading. */
export function docsPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500 || !/^\/docs(?:\/|#|$)/u.test(value)) {
    throw new TypeError('Use a documentation path such as /docs/learn/state.')
  }
  const url = new URL(value, 'https://vidact.local')
  if (
    url.origin !== 'https://vidact.local' ||
    !/^\/docs(?:\/|$)/u.test(url.pathname) ||
    url.search ||
    value.includes('\\')
  ) {
    throw new TypeError('Use a local documentation path without query parameters.')
  }
  return url.pathname + url.hash
}
