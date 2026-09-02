import { classes } from '@/lib/classes.ts'

type DivProps = JSX.IntrinsicElements['div']
type HeadingProps = JSX.IntrinsicElements['h3']
type ParagraphProps = JSX.IntrinsicElements['p']

export function Card({ className, children, ...props }: DivProps) {
  return (
    <div
      className={classes(
        'flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...props }: DivProps) {
  return (
    <div className={classes('grid gap-1.5 px-6', className)} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children, ...props }: HeadingProps) {
  return (
    <h3 className={classes('font-semibold leading-none', className)} {...props}>
      {children}
    </h3>
  )
}

export function CardDescription({ className, children, ...props }: ParagraphProps) {
  return (
    <p className={classes('text-sm leading-relaxed text-muted-foreground', className)} {...props}>
      {children}
    </p>
  )
}

export function CardContent({ className, children, ...props }: DivProps) {
  return (
    <div className={classes('px-6', className)} {...props}>
      {children}
    </div>
  )
}
