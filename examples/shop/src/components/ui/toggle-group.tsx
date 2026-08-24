'use client'

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group'
import type { VidactNode } from '@vidact/react-types'
import { type VariantProps } from 'class-variance-authority'

import { toggleVariants } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

type ToggleGroupProps = Omit<ToggleGroupPrimitive.Props, 'children'> &
  VariantProps<typeof toggleVariants> & {
    children?: VidactNode
    spacing?: number
    orientation?: 'horizontal' | 'vertical'
  }

type ToggleGroupItemProps = Omit<TogglePrimitive.Props, 'children'> &
  VariantProps<typeof toggleVariants> & {
    children?: VidactNode
  }

const VidactTogglePrimitive = TogglePrimitive as unknown as (
  props: ToggleGroupItemProps,
) => JSX.Element

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = 'horizontal',
  children,
  value: _value,
  onValueChange: _onValueChange,
  ...props
}: ToggleGroupProps): JSX.Element {
  return (
    <div
      {...(props as unknown as JSX.IntrinsicElements['div'])}
      role="group"
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ '--gap': spacing } as Record<string, number>}
      className={cn(
        'group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-none data-[size=sm]:rounded-none data-vertical:flex-col data-vertical:items-stretch',
        className,
      )}
    >
      {children}
    </div>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = 'default',
  size = 'default',
  ...props
}: ToggleGroupItemProps): JSX.Element {
  return (
    <VidactTogglePrimitive
      {...props}
      data-slot="toggle-group-item"
      data-variant={variant}
      data-size={size}
      className={cn(
        'shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-none group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-none group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-none group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-none group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t',
        toggleVariants({
          variant,
          size,
        }),
        className,
      )}
    >
      {children}
    </VidactTogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
export type { ToggleGroupItemProps, ToggleGroupProps }
