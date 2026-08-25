import { defineFileRoute } from '@vidact/start'

export const Route = defineFileRoute({
  server: {
    handlers: {
      GET: () => Response.json({ now: new Date().toISOString() }),
    },
  },
})
