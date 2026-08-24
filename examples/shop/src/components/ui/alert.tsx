import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-none border px-2.5 py-2 text-left text-xs has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type DivProps = JSX.IntrinsicElements['div']

function Alert({
  className,
  variant,
  children,
  ...props
}: DivProps & VariantProps<typeof alertVariants>): JSX.Element {
  return (
    <div
      {...props}
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
    >
      {children}
    </div>
  )
}

function AlertTitle({ className, children, ...props }: DivProps): JSX.Element {
  return (
    <div
      {...props}
      data-slot="alert-title"
      className={cn(
        'font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}

function AlertDescription({ className, children, ...props }: DivProps): JSX.Element {
  return (
    <div
      {...props}
      data-slot="alert-description"
      className={cn(
        'text-xs/relaxed text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

function AlertAction({ className, children, ...props }: DivProps): JSX.Element {
  return (
    <div
      {...props}
      data-slot="alert-action"
      className={cn(
        'absolute top-[calc(--spacing(1.25))] right-[calc(--spacing(1.25))]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
