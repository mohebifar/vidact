import { classes } from '@/lib/classes.ts'

type BadgeProps = JSX.IntrinsicElements['span'] & {
  readonly variant?: 'default' | 'outline' | 'secondary'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const { children, ...spanProps } = props
  return (
    <span
      className={classes(
        'inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-semibold leading-none',
        variant === 'default' && 'border-transparent bg-primary text-primary-foreground',
        variant === 'secondary' && 'border-transparent bg-secondary text-secondary-foreground',
        variant === 'outline' && 'border-border text-foreground',
        className,
      )}
      {...spanProps}
    >
      {children}
    </span>
  )
}
