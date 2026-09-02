// Shipped verbatim as dist/virtual.d.ts: an ambient declaration cannot be bundled
// without becoming a module augmentation, so it names the built router file.
declare module 'virtual:vidact-start/routes' {
  export const routeManifest: import('./router.js').RouteManifest
}
