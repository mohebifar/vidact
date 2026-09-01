import { useState } from 'react'

import { classes } from '@/lib/classes.ts'

type SwitchProps = Omit<
  JSX.IntrinsicElements['button'],
  'aria-checked' | 'aria-label' | 'children' | 'onChange' | 'onClick' | 'role' | 'type'
> & {
  readonly defaultChecked?: boolean
  readonly label: string
}

export function Switch({ className, defaultChecked = false, label, ...props }: SwitchProps) {
  const [checked, setChecked] = useState(defaultChecked)

  return (
    <label className="inline-flex items-center gap-3 text-sm font-medium">
      <button
        aria-checked={checked}
        aria-label={label}
        className={classes(
          'group inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:bg-primary',
          className,
        )}
        data-state={checked ? 'checked' : 'unchecked'}
        onClick={() => setChecked(!checked)}
        role="switch"
        type="button"
        {...props}
      >
        <span
          className="pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform group-data-[state=checked]:translate-x-4 group-data-[state=unchecked]:translate-x-0"
          data-slot="switch-thumb"
        />
      </button>
      <span>{label}</span>
    </label>
  )
}
