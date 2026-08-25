import { cn } from '@/lib/utils'

type DivProps = JSX.IntrinsicElements['div']

function Card({
  className,
  size = 'default',
  children,
  ...props
}: DivProps & { size?: 'default' | 'sm' }): JSX.Element {
  return (
    <div
      {...props}
      data-slot="card"
      data-size={size}
      className={cn(
        'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-none bg-card py-(--card-spacing) text-xs/relaxed text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-none *:[img:last-child]:rounded-none',
        className,
      )}
    >
      {children}
    </div>
  )
}

function CardHeader({ className, children, ...props }: DivProps): JSX.Element {
  return (
    <div
      {...props}
      data-slot="card-header"
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-none px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
        className,
      )}
    >
      {children}
    </div>
  )
}

function CardTitle({ className, children, ...props }: DivProps): JSX.Element {
  return (
    <div
      {...props}
      data-slot="card-title"
      className={cn(
        'font-heading text-sm font-medium group-data-[size=sm]/card:text-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}

function CardDescription({ className, children, ...props }: DivProps): JSX.Element {
  return (
    <div
      {...props}
      data-slot="card-description"
      className={cn('text-xs/relaxed text-muted-foreground', className)}
    >
      {children}
    </div>
  )
}

function CardAction({ className, children, ...props }: DivProps): JSX.Element {
  return (
    <div
      {...props}
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
    >
      {children}
    </div>
  )
}

function CardContent({ className, children, ...props }: DivProps): JSX.Element {
  return (
    <div {...props} data-slot="card-content" className={cn('px-(--card-spacing)', className)}>
      {children}
    </div>
  )
}

function CardFooter({ className, children, ...props }: DivProps): JSX.Element {
  return (
    <div
      {...props}
      data-slot="card-footer"
      className={cn('flex items-center rounded-none border-t p-(--card-spacing)', className)}
    >
      {children}
    </div>
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
