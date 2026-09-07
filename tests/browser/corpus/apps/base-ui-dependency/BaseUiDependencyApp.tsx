import { Accordion } from '@base-ui/react/accordion'
import { Button } from '@base-ui/react/button'
import { Switch } from '@base-ui/react/switch'
import type { VidactNode } from '@vidact/react-types'
import { useState } from 'react'

type WithVidactChildren<Props> = Omit<Props, 'children'> & {
  readonly children?: VidactNode
}

type ButtonProps = Omit<Button.Props, 'children' | 'render'> & {
  readonly children?: VidactNode
  readonly render?: Button.Props['render'] | JSX.Element
}

const BaseButton = Button as unknown as (props: ButtonProps) => JSX.Element
const BaseSwitchRoot = Switch.Root as unknown as (
  props: WithVidactChildren<Switch.Root.Props>,
) => JSX.Element
const BaseSwitchThumb = Switch.Thumb as unknown as (props: Switch.Thumb.Props) => JSX.Element
const BaseAccordionRoot = Accordion.Root as unknown as (
  props: WithVidactChildren<Accordion.Root.Props<string>>,
) => JSX.Element
const BaseAccordionItem = Accordion.Item as unknown as (
  props: WithVidactChildren<Accordion.Item.Props>,
) => JSX.Element
const BaseAccordionHeader = Accordion.Header as unknown as (
  props: WithVidactChildren<Accordion.Header.Props>,
) => JSX.Element
const BaseAccordionTrigger = Accordion.Trigger as unknown as (
  props: WithVidactChildren<Accordion.Trigger.Props>,
) => JSX.Element
const BaseAccordionPanel = Accordion.Panel as unknown as (
  props: WithVidactChildren<Accordion.Panel.Props>,
) => JSX.Element

export function BaseUiDependencyApp(): JSX.Element {
  const [count, setCount] = useState(0)

  return (
    <main data-base-ui-dependency>
      <BaseButton
        data-base-counter
        className="counter"
        onClick={() => setCount((value) => value + 1)}
      >
        Count {count}
      </BaseButton>
      <BaseButton
        render={<a data-base-link href="#details" />}
        nativeButton={false}
        onClick={(event) => event.preventDefault()}
      >
        Details
      </BaseButton>
      <section data-base-controls>
        <BaseSwitchRoot data-base-switch aria-label="Published setting" defaultChecked>
          <BaseSwitchThumb data-base-switch-thumb />
        </BaseSwitchRoot>
        <BaseAccordionRoot data-base-accordion defaultValue={['details']}>
          <BaseAccordionItem data-base-accordion-item value="details">
            <BaseAccordionHeader>
              <BaseAccordionTrigger data-base-accordion-trigger>
                Published details
              </BaseAccordionTrigger>
            </BaseAccordionHeader>
            <BaseAccordionPanel data-base-accordion-panel keepMounted>
              Dependency content
            </BaseAccordionPanel>
          </BaseAccordionItem>
        </BaseAccordionRoot>
      </section>
    </main>
  )
}
