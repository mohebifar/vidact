import * as React from 'react'

import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

export function PopoverProof() {
  const [controlledOpen, setControlledOpen] = React.useState(false)
  const [controlledRequests, setControlledRequests] = React.useState(0)
  const [uncontrolledChanges, setUncontrolledChanges] = React.useState(0)

  return (
    <section data-testid="popover-proof">
      <button data-testid="outside-target">Outside target</button>

      <Popover onOpenChange={() => setUncontrolledChanges(uncontrolledChanges + 1)}>
        <PopoverTrigger data-testid="uncontrolled-trigger">Open profile</PopoverTrigger>
        <PopoverContent data-testid="uncontrolled-content" side="bottom" align="start">
          <PopoverTitle>Profile</PopoverTitle>
          <PopoverDescription>Change the current profile.</PopoverDescription>
          <button data-testid="inside-action">Save profile</button>
          <Popover>
            <PopoverTrigger data-testid="nested-trigger">Open nested help</PopoverTrigger>
            <PopoverContent data-testid="nested-content" aria-label="Nested help">
              <button data-testid="nested-action">Use this profile</button>
            </PopoverContent>
          </Popover>
        </PopoverContent>
      </Popover>

      <output data-testid="uncontrolled-changes">{uncontrolledChanges}</output>

      <Popover
        open={controlledOpen}
        onOpenChange={() => setControlledRequests(controlledRequests + 1)}
      >
        <PopoverTrigger data-testid="controlled-trigger">Controlled trigger</PopoverTrigger>
        <PopoverContent data-testid="controlled-content" aria-label="Controlled profile">
          Controlled content
        </PopoverContent>
      </Popover>

      <button data-testid="publish-controlled" onClick={() => setControlledOpen(!controlledOpen)}>
        Publish controlled state
      </button>
      <output data-testid="controlled-requests">{controlledRequests}</output>
    </section>
  )
}
