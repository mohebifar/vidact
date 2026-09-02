import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import * as React from 'react'

import { cn } from './classes.ts'

// A shadcn-shaped wrapper over a published Base UI primitive. It lives with the
// plugin tests rather than in an example app so that trimming an example cannot
// silently remove this suite's coverage.

function Avatar({
  className,
  size = 'default',
  children,
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: 'default' | 'sm' | 'lg'
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn('group/avatar relative flex size-8 shrink-0 rounded-full', className)}
      {...props}
    >
      {children}
    </AvatarPrimitive.Root>
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full rounded-full object-cover', className)}
      {...props}
    />
  )
}

function AvatarFallback({ className, children, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn('flex size-full items-center justify-center rounded-full', className)}
      {...props}
    >
      {children}
    </AvatarPrimitive.Fallback>
  )
}

function AvatarGroup({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="avatar-group" className={cn('flex -space-x-2', className)} {...props}>
      {children}
    </div>
  )
}

export { Avatar, AvatarFallback, AvatarGroup, AvatarImage }
