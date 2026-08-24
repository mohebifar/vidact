import { cn } from '@/lib/utils'

function Skeleton({ className, children, ...props }: JSX.IntrinsicElements['div']): JSX.Element {
  return (
    <div
      {...props}
      data-slot="skeleton"
      className={cn('animate-pulse rounded-none bg-muted', className)}
    >
      {children}
    </div>
  )
}

export { Skeleton }
