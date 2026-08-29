import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export function ShadcnExpansionProof() {
  return (
    <section data-testid="expansion-proof">
      <Avatar data-testid="proof-avatar">
        <AvatarFallback>VD</AvatarFallback>
      </Avatar>
      <Collapsible data-testid="proof-collapsible">
        <CollapsibleTrigger>Toggle details</CollapsibleTrigger>
        <CollapsibleContent>
          <p data-testid="proof-content">Compiled through Base UI</p>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
