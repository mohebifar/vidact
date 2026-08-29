import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'

function Collapsible({ children, ...props }: CollapsiblePrimitive.Root.Props) {
  return (
    <CollapsiblePrimitive.Root data-slot="collapsible" {...props}>
      {children}
    </CollapsiblePrimitive.Root>
  )
}

function CollapsibleTrigger({ children, ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props}>
      {children}
    </CollapsiblePrimitive.Trigger>
  )
}

function CollapsibleContent({ children, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props}>
      {children}
    </CollapsiblePrimitive.Panel>
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
