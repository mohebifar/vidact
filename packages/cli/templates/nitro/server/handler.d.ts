/**
 * The request handler that `vite build --config vite.server.config.ts` emits from
 * src/server.ts. Nitro maps this specifier to the built file, and the declaration
 * keeps the project type-checkable before the first build.
 */
declare module 'vidact-start-handler' {
  const handler: (request: Request) => Response | Promise<Response>
  export default handler
}
