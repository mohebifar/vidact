import * as React from 'react'
import { createPortal } from 'react-dom'

import { createOwnedStore, type OwnedStore } from '@/lib/owned-store'
import { cn } from '@/lib/utils'

type CloseOrigin = 'escape' | 'external' | 'outside-pointer' | 'trigger'
type PopoverSide = 'bottom' | 'left' | 'right' | 'top'
type PopoverAlign = 'center' | 'end' | 'start'

interface PopoverLayer {
  readonly content: HTMLElement
  readonly parent: PopoverLayer | null
  readonly trigger: HTMLButtonElement
}

type PopoverSnapshot = {
  open: boolean
}

type PopoverActions = {
  getTrigger(): HTMLButtonElement | null
  requestOpen(next: boolean, origin: CloseOrigin): void
  setTrigger(trigger: HTMLButtonElement): void
  takeCloseOrigin(): CloseOrigin | null
}

type PopoverContextValue = {
  actions: PopoverActions
  snapshot: PopoverSnapshot
}

type PopoverStore = OwnedStore<PopoverSnapshot> & {
  actions: PopoverActions
  configure(controlled: boolean, callback: PopoverProps['onOpenChange'], nextOpen: boolean): void
}

type PopoverProps = {
  children?: React.ReactNode
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  open?: boolean
}

type PopoverTriggerProps = Omit<React.ComponentPropsWithRef<'button'>, 'id'>

type PopoverContentProps = React.ComponentPropsWithRef<'div'> & {
  align?: PopoverAlign
  alignOffset?: number
  side?: PopoverSide
  sideOffset?: number
}

type PopoverPopupProps = Required<
  Pick<PopoverContentProps, 'align' | 'alignOffset' | 'side' | 'sideOffset'>
> &
  Omit<PopoverContentProps, 'align' | 'alignOffset' | 'side' | 'sideOffset'>

const PopoverContext = React.createContext<PopoverContextValue | null>(null)
const openPopoverLayers: PopoverLayer[] = []
let nextPopoverId = 0

function Popover({ children, defaultOpen = false, onOpenChange, open }: PopoverProps) {
  const store = createPopoverStore()
  const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  React.useLayoutEffect(() => {
    store.configure(open !== undefined, onOpenChange, open ?? defaultOpen)
  }, [defaultOpen, onOpenChange, open])

  return (
    <PopoverContext.Provider data-slot="popover" value={{ actions: store.actions, snapshot }}>
      {children}
    </PopoverContext.Provider>
  )
}

function PopoverTrigger({
  children,
  onClick,
  ref,
  type = 'button',
  ...props
}: PopoverTriggerProps) {
  const context = usePopoverContext()
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  React.useLayoutEffect(() => {
    if (triggerRef.current !== null) context.actions.setTrigger(triggerRef.current)
  }, [])

  return (
    <button
      {...props}
      ref={(node) => {
        triggerRef.current = node
        assignRef(ref, node)
      }}
      type={type}
      data-slot="popover-trigger"
      aria-expanded={context.snapshot.open}
      aria-haspopup="dialog"
      onClick={(event) => {
        context.actions.setTrigger(event.currentTarget)
        onClick?.(event)
        if (!event.defaultPrevented) {
          context.actions.requestOpen(!context.snapshot.open, 'trigger')
        }
      }}
    >
      {children}
    </button>
  )
}

function PopoverContent({
  align = 'center',
  alignOffset = 0,
  children,
  className,
  ref,
  side = 'bottom',
  sideOffset = 4,
  ...props
}: PopoverContentProps) {
  const context = usePopoverContext()

  return context.snapshot.open ? (
    <PopoverPortal
      {...props}
      ref={ref}
      align={align}
      alignOffset={alignOffset}
      className={className}
      side={side}
      sideOffset={sideOffset}
    >
      {children}
    </PopoverPortal>
  ) : null
}

function PopoverPortal({ children, ...props }: PopoverPopupProps) {
  return createPortal(<PopoverPopup {...props}>{children}</PopoverPopup>, document.body)
}

function PopoverPopup({
  align,
  alignOffset,
  children,
  className,
  ref,
  side,
  sideOffset,
  style,
  ...props
}: PopoverPopupProps) {
  const context = usePopoverContext()
  const contentRef = React.useRef<HTMLDivElement>(null)
  const positionerRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const content = contentRef.current
    const positioner = positionerRef.current
    if (content === null || positioner === null) return
    assignRef(ref, content)

    const trigger = context.actions.getTrigger()
    if (trigger === null) {
      return () => assignRef(ref, null)
    }

    nextPopoverId += 1
    const id = nextPopoverId
    content.id = `vidact-popover-content-${id}`
    trigger.setAttribute('aria-controls', content.id)
    applyPosition(positioner, trigger, side, align, sideOffset, alignOffset)
    const updatePosition = () =>
      applyPosition(positioner, trigger, side, align, sideOffset, alignOffset)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    const title = content.querySelector<HTMLElement>('[data-slot="popover-title"]')
    const description = content.querySelector<HTMLElement>('[data-slot="popover-description"]')
    if (title !== null) {
      if (title.id === '') title.id = `vidact-popover-title-${id}`
      content.setAttribute('aria-labelledby', title.id)
    }
    if (description !== null) {
      if (description.id === '') description.id = `vidact-popover-description-${id}`
      content.setAttribute('aria-describedby', description.id)
    }

    const firstFocusable = content.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    ;(firstFocusable ?? content).focus()

    const layer: PopoverLayer = {
      content,
      parent:
        openPopoverLayers.findLast((candidate) => candidate.content.contains(trigger)) ?? null,
      trigger,
    }
    openPopoverLayers.push(layer)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || openPopoverLayers.at(-1) !== layer) return
      event.preventDefault()
      context.actions.requestOpen(false, 'escape')
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (logicalLayerContains(layer, target) || openPopoverLayers.at(-1) !== layer) return
      context.actions.requestOpen(false, 'outside-pointer')
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      const layerIndex = openPopoverLayers.lastIndexOf(layer)
      if (layerIndex !== -1) openPopoverLayers.splice(layerIndex, 1)
      trigger.removeAttribute('aria-controls')
      assignRef(ref, null)

      const origin = context.actions.takeCloseOrigin()
      queueMicrotask(() => {
        const active = document.activeElement
        if (origin === 'escape' || origin === 'trigger') {
          trigger.focus()
        } else if (
          origin === 'outside-pointer' &&
          (active === document.body || active === null || content.contains(active))
        ) {
          trigger.focus()
        }
      })
    }
  }, [])

  return (
    <div ref={positionerRef} className="isolate z-50" data-slot="popover-positioner">
      <div
        {...props}
        ref={contentRef}
        role="dialog"
        tabIndex={-1}
        data-open=""
        data-side={side}
        data-align={align}
        data-slot="popover-content"
        className={cn(
          'z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-none bg-popover p-2.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
          className,
        )}
        style={style}
      >
        {children}
      </div>
    </div>
  )
}

function logicalLayerContains(layer: PopoverLayer, target: Node): boolean {
  if (layer.content.contains(target) || layer.trigger.contains(target)) return true
  return openPopoverLayers.some((candidate) => {
    if (!candidate.content.contains(target) && !candidate.trigger.contains(target)) return false
    for (let parent = candidate.parent; parent !== null; parent = parent.parent) {
      if (parent === layer) return true
    }
    return false
  })
}

function PopoverHeader({ children, className, ref, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      {...props}
      ref={ref}
      data-slot="popover-header"
      className={cn('flex flex-col gap-1 text-xs', className)}
    >
      {children}
    </div>
  )
}

function PopoverTitle({
  children,
  className,
  id,
  ref,
  ...props
}: React.ComponentPropsWithRef<'h2'>) {
  return (
    <h2
      {...props}
      ref={ref}
      id={id}
      data-slot="popover-title"
      className={cn('text-sm font-medium', className)}
    >
      {children}
    </h2>
  )
}

function PopoverDescription({
  children,
  className,
  id,
  ref,
  ...props
}: React.ComponentPropsWithRef<'p'>) {
  return (
    <p
      {...props}
      ref={ref}
      id={id}
      data-slot="popover-description"
      className={cn('text-xs/relaxed text-muted-foreground', className)}
    >
      {children}
    </p>
  )
}

function createPopoverStore(): PopoverStore {
  const store = createOwnedStore<PopoverSnapshot>({ open: false })
  let callback: PopoverProps['onOpenChange']
  let closeOrigin: CloseOrigin | null = null
  let pendingControlledClose: {
    activeElement: Element | null
    origin: CloseOrigin
    token: number
  } | null = null
  let nextCloseToken = 0
  let configured = false
  let controlled = false
  let trigger: HTMLButtonElement | null = null

  const actions: PopoverActions = {
    getTrigger: () => trigger,
    requestOpen(next, origin) {
      if (!next) {
        if (controlled) {
          nextCloseToken += 1
          const token = nextCloseToken
          pendingControlledClose = {
            activeElement: document.activeElement,
            origin,
            token,
          }
          queueMicrotask(() => {
            if (pendingControlledClose?.token === token && store.getSnapshot().open) {
              pendingControlledClose = null
            }
          })
        } else {
          closeOrigin = origin
        }
      }
      callback?.(next)
      if (!controlled) store.publish({ ...store.getSnapshot(), open: next })
    },
    setTrigger(nextTrigger) {
      trigger = nextTrigger
    },
    takeCloseOrigin() {
      const origin = closeOrigin
      closeOrigin = null
      return origin
    },
  }

  return {
    ...store,
    actions,
    configure(nextControlled, nextCallback, nextOpen) {
      callback = nextCallback
      if (configured && !controlled) return
      if (!configured) {
        configured = true
        controlled = nextControlled
      }
      if (controlled && nextOpen) pendingControlledClose = null
      if (store.getSnapshot().open === nextOpen) return
      if (!nextOpen) {
        const pending = pendingControlledClose
        const focusMovedOutsideTrigger =
          pending?.origin === 'trigger' &&
          document.activeElement !== pending.activeElement &&
          document.activeElement !== trigger
        closeOrigin = focusMovedOutsideTrigger ? 'external' : (pending?.origin ?? 'external')
        pendingControlledClose = null
      }
      store.publish({ ...store.getSnapshot(), open: nextOpen })
    },
  }
}

function applyPosition(
  positioner: HTMLDivElement,
  trigger: HTMLButtonElement,
  side: PopoverSide,
  align: PopoverAlign,
  sideOffset: number,
  alignOffset: number,
) {
  const triggerRect = trigger.getBoundingClientRect()
  const contentRect = positioner.getBoundingClientRect()
  let top = triggerRect.bottom + sideOffset
  let left = alignedOffset(
    triggerRect.left,
    triggerRect.width,
    contentRect.width,
    align,
    alignOffset,
  )

  if (side === 'top') top = triggerRect.top - contentRect.height - sideOffset
  if (side === 'left') {
    left = triggerRect.left - contentRect.width - sideOffset
    top = alignedOffset(triggerRect.top, triggerRect.height, contentRect.height, align, alignOffset)
  }
  if (side === 'right') {
    left = triggerRect.right + sideOffset
    top = alignedOffset(triggerRect.top, triggerRect.height, contentRect.height, align, alignOffset)
  }

  positioner.style.position = 'fixed'
  positioner.style.left = `${left}px`
  positioner.style.top = `${top}px`
}

function alignedOffset(
  start: number,
  anchorSize: number,
  contentSize: number,
  align: PopoverAlign,
  offset: number,
) {
  if (align === 'start') return start + offset
  if (align === 'end') return start + anchorSize - contentSize + offset
  return start + (anchorSize - contentSize) / 2 + offset
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref !== null && ref !== undefined) ref.current = value
}

function usePopoverContext() {
  const context = React.useContext(PopoverContext)
  if (context === null) throw new Error('Popover components must be nested inside Popover')
  return context
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger }
