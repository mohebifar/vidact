import { defineFileRoute } from '@vidact/start'

export const Route = defineFileRoute({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!import.meta.env.SSR) throw new Error('Documentation content is supplied by the server')
        return (await import('../../lib/docs-api.server.ts')).readDocs(request)
      },
    },
  },
})
