import type { VidactNode } from '@vidact/react-types'
import { Link } from '@vidact/start'

import { classes } from '@/lib/classes.ts'

type ButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost'
type ButtonSize = 'default' | 'sm' | 'icon'

const variantClasses: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
  outline:
    'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
}

const sizeClasses: Record<ButtonSize, string> = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 rounded-md px-3 text-xs',
  icon: 'size-9',
}

type ButtonProps = {
  readonly children?: VidactNode
  readonly className?: string
  readonly disabled?: boolean
  readonly onClick?: () => void
  readonly size?: ButtonSize
  readonly type?: 'button' | 'reset' | 'submit'
  readonly variant?: ButtonVariant
}

type ButtonLinkProps = {
  readonly children?: VidactNode
  readonly className?: string
  readonly href: string
  readonly size?: ButtonSize
  readonly variant?: ButtonVariant
}

export function Button({
  children,
  className,
  disabled,
  onClick,
  size = 'default',
  type = 'button',
  variant = 'default',
}: ButtonProps) {
  return (
    <button
      className={buttonClasses(variant, size, className)}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  )
}

export function ButtonLink({
  children,
  className,
  href,
  size = 'default',
  variant = 'default',
}: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} href={href}>
      {children}
    </Link>
  )
}

function buttonClasses(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return classes(
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
    variantClasses[variant],
    sizeClasses[size],
    className,
  )
}
