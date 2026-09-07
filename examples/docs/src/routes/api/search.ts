import { defineFileRoute } from '@vidact/start'

export const Route = defineFileRoute({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!import.meta.env.SSR) throw new Error('Search runs on the server')
        return (await import('../../lib/search.server.ts')).searchDocs(request)
      },
    },
  },
})
