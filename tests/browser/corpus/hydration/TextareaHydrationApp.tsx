import { useState } from 'react'

/**
 * A textarea whose content comes from render. The server cannot place hydration
 * markers inside it, so this exercises claiming the parsed text without any.
 */
export function TextareaHydrationApp({ initialDraft }: { readonly initialDraft: string }) {
  const [bumps, setBumps] = useState(0)
  return (
    <form>
      <textarea aria-label="Draft" readOnly>
        {initialDraft}
      </textarea>
      <button type="button" onClick={() => setBumps((current) => current + 1)}>
        Bump
      </button>
      <output>{bumps}</output>
    </form>
  )
}
