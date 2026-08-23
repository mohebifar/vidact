import { mountCompiled } from '@vidact/runtime'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { DomSemanticsApp } from './DomSemanticsApp.tsx'

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled DOM semantics app', () => {
  it('constructs HTML, SVG, and MathML in their owning namespaces', () => {
    const host = mountApp()
    const svg = host.querySelector<SVGSVGElement>('[data-svg]')!
    const circle = host.querySelector<SVGCircleElement>('[data-circle]')!
    const use = host.querySelector<SVGUseElement>('[data-use]')!
    const image = host.querySelector<SVGImageElement>('[data-image]')!
    const foreignObject = host.querySelector<SVGForeignObjectElement>('[data-foreign-object]')!
    const htmlIsland = host.querySelector<HTMLElement>('[data-foreign-html]')!
    const componentSvg = host.querySelector<SVGRectElement>('[data-component-svg]')!
    const componentHtml = host.querySelector<HTMLElement>('[data-component-html]')!
    const math = host.querySelector<MathMLElement>('[data-math]')!
    const row = host.querySelector<MathMLElement>('mrow')!

    expect(host.querySelector('[data-dom-semantics]')?.namespaceURI).toBe(HTML_NAMESPACE)
    expect(svg.namespaceURI).toBe(SVG_NAMESPACE)
    expect(circle.namespaceURI).toBe(SVG_NAMESPACE)
    expect(foreignObject.namespaceURI).toBe(SVG_NAMESPACE)
    expect(htmlIsland.namespaceURI).toBe(HTML_NAMESPACE)
    expect(componentSvg.namespaceURI).toBe(SVG_NAMESPACE)
    expect(componentHtml.namespaceURI).toBe(HTML_NAMESPACE)
    expect(math.namespaceURI).toBe(MATHML_NAMESPACE)
    expect(row.namespaceURI).toBe(MATHML_NAMESPACE)
    expect(use.getAttributeNS(XLINK_NAMESPACE, 'href')).toBe('#shape')
    expect(image.getAttribute('crossorigin')).toBe('anonymous')
    expect(svg.getAttributeNS(XMLNS_NAMESPACE, 'xlink')).toBe(XLINK_NAMESPACE)
    expect(math.getAttribute('displaystyle')).toBe('false')
  })

  it('retains inherited namespaces when component branches mount later', async () => {
    const host = mountApp()
    const svg = host.querySelector<SVGSVGElement>('[data-svg]')!
    const math = host.querySelector<MathMLElement>('[data-math]')!
    const toggle = host.querySelector<HTMLButtonElement>('[data-toggle-deferred]')!

    await captureMutations(host, () => toggle.click())
    expect(host.querySelector('[data-deferred-svg]')).toBeNull()
    expect(host.querySelector('[data-deferred-math]')).toBeNull()

    await captureMutations(host, () => toggle.click())
    const circle = host.querySelector<SVGCircleElement>('[data-deferred-svg]')!
    const row = host.querySelector<MathMLElement>('[data-deferred-math]')!
    expect(host.querySelector('[data-svg]')).toBe(svg)
    expect(host.querySelector('[data-math]')).toBe(math)
    expect(circle.namespaceURI).toBe(SVG_NAMESPACE)
    expect(circle.getAttribute('tabindex')).toBe('0')
    expect(circle.tabIndex).toBe(0)
    expect(row.namespaceURI).toBe(MATHML_NAMESPACE)
  })

  it('updates attributes and styles without retaining stale values or remounting', async () => {
    const host = mountApp()
    const semantics = host.querySelector<HTMLElement>('[data-boolean]')!
    const styled = host.querySelector<HTMLElement>('[data-style]')!
    const svg = host.querySelector<SVGSVGElement>('[data-svg]')!
    const circle = host.querySelector<SVGCircleElement>('[data-circle]')!
    const toggle = host.querySelector<HTMLButtonElement>('[data-toggle]')!

    expect(semantics.getAttribute('data-boolean')).toBe('true')
    expect(semantics.getAttribute('aria-hidden')).toBe('false')
    expect(semantics.title).toBe('active title')
    expect(styled.style.backgroundColor).toBe('black')
    expect(styled.style.width).toBe('12px')
    expect(styled.style.getPropertyValue('--tone')).toBe('warm')
    expect(circle.getAttribute('stroke-width')).toBe('1')

    const capture = await captureMutations(host, () => toggle.click())

    expect(host.querySelector('[data-boolean]')).toBe(semantics)
    expect(host.querySelector('[data-style]')).toBe(styled)
    expect(host.querySelector('[data-svg]')).toBe(svg)
    expect(host.querySelector('[data-circle]')).toBe(circle)
    expect(semantics.getAttribute('data-boolean')).toBe('false')
    expect(semantics.getAttribute('aria-hidden')).toBe('true')
    expect(semantics.hasAttribute('title')).toBe(false)
    expect(semantics.title).toBe('')
    expect(styled.style.color).toBe('blue')
    expect(styled.style.backgroundColor).toBe('')
    expect(styled.style.width).toBe('0px')
    expect(styled.style.getPropertyValue('--tone')).toBe('2')
    expect(circle.getAttribute('stroke-width')).toBe('3')
    expect(() =>
      assertMutationEnvelope(
        capture.records,
        [
          { type: 'attributes', target: semantics, attributeName: 'data-boolean' },
          { type: 'attributes', target: semantics, attributeName: 'aria-hidden' },
          { type: 'attributes', target: semantics, attributeName: 'title' },
          { type: 'attributes', target: styled, attributeName: 'style' },
          { type: 'attributes', target: circle, attributeName: 'stroke-width' },
        ],
        'DOM semantic toggle',
      ),
    ).not.toThrow()
  })

  it('uses capture phase and React-style controlled form change timing', async () => {
    const host = mountApp()
    const captureParent = host.querySelector<HTMLElement>('[data-capture-parent]')!
    const captureChild = host.querySelector<HTMLButtonElement>('[data-capture-child]')!
    const eventOrder = host.querySelector<HTMLOutputElement>('[data-event-order]')!
    const text = host.querySelector<HTMLInputElement>('[data-controlled-text]')!
    const textOutput = host.querySelector<HTMLOutputElement>('[data-controlled-output]')!
    const restore = host.querySelector<HTMLInputElement>('[data-controlled-restore]')!
    const checkbox = host.querySelector<HTMLInputElement>('[data-controlled-checkbox]')!
    const checkedOutput = host.querySelector<HTMLOutputElement>('[data-checked-output]')!
    const select = host.querySelector<HTMLSelectElement>('[data-controlled-select]')!
    const ancestor = host.querySelector<HTMLInputElement>('[data-ancestor-controlled]')!
    const ancestorOutput = host.querySelector<HTMLOutputElement>('[data-ancestor-output]')!
    const ancestorTrace = host.querySelector<HTMLOutputElement>('[data-ancestor-trace]')!
    const modeFirst = host.querySelector<HTMLSelectElement>('[data-mode-select-first]')!
    const valueFirst = host.querySelector<HTMLSelectElement>('[data-value-select-first]')!
    const textarea = host.querySelector<HTMLTextAreaElement>('[data-controlled-textarea]')!
    const textareaOutput = host.querySelector<HTMLOutputElement>('[data-textarea-output]')!
    const radioA = host.querySelector<HTMLInputElement>('[data-controlled-radio-a]')!
    const radioB = host.querySelector<HTMLInputElement>('[data-controlled-radio-b]')!
    const radioOutput = host.querySelector<HTMLOutputElement>('[data-radio-output]')!

    await captureMutations(host, () => captureChild.click())
    expect(host.querySelector('[data-capture-parent]')).toBe(captureParent)
    expect(host.querySelector('[data-capture-child]')).toBe(captureChild)
    expect(eventOrder.textContent).toBe('capture,bubble')

    text.value = 'typed'
    await captureMutations(host, () =>
      text.dispatchEvent(new InputEvent('input', { bubbles: true })),
    )
    expect(host.querySelector('[data-controlled-text]')).toBe(text)
    expect(text.value).toBe('typed')
    expect(textOutput.textContent).toBe('typed')

    restore.value = 'browser edit'
    await captureMutations(host, () =>
      restore.dispatchEvent(new InputEvent('input', { bubbles: true })),
    )
    expect(restore.value).toBe('locked')

    ancestor.value = 'bubbled'
    await captureMutations(host, () =>
      ancestor.dispatchEvent(new InputEvent('input', { bubbles: true })),
    )
    expect(host.querySelector('[data-ancestor-controlled]')).toBe(ancestor)
    expect(ancestor.value).toBe('bubbled')
    expect(ancestorOutput.textContent).toBe('bubbled')
    expect(ancestorTrace.textContent).toBe('capture:bubbled,bubble:bubbled')

    textarea.value = 'edited notes'
    await captureMutations(host, () =>
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true })),
    )
    expect(host.querySelector('[data-controlled-textarea]')).toBe(textarea)
    expect(textarea.value).toBe('edited notes')
    expect(textareaOutput.textContent).toBe('edited notes')

    expect(radioA.checked).toBe(true)
    expect(radioB.checked).toBe(false)
    await captureMutations(host, () => radioB.click())
    expect(host.querySelector('[data-controlled-radio-a]')).toBe(radioA)
    expect(host.querySelector('[data-controlled-radio-b]')).toBe(radioB)
    expect(radioA.checked).toBe(false)
    expect(radioB.checked).toBe(true)
    expect(radioOutput.textContent).toBe('b')

    await captureMutations(host, () => checkbox.click())
    expect(host.querySelector('[data-controlled-checkbox]')).toBe(checkbox)
    expect(checkbox.checked).toBe(true)
    expect(checkedOutput.textContent).toBe('checked')

    expect(selectedValues(select)).toEqual(['b'])
    await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-select-outer]')!.click(),
    )
    expect(host.querySelector('[data-controlled-select]')).toBe(select)
    expect(selectedValues(select)).toEqual(['a', 'c'])

    select.options[0]!.selected = false
    select.options[1]!.selected = true
    select.options[2]!.selected = false
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(selectedValues(select)).toEqual(['b'])

    expect(modeFirst.multiple).toBe(false)
    expect(valueFirst.multiple).toBe(false)
    expect(selectedValues(modeFirst)).toEqual(['b'])
    expect(selectedValues(valueFirst)).toEqual(['b'])
    await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-toggle-select-mode]')!.click(),
    )
    expect(modeFirst.multiple).toBe(true)
    expect(valueFirst.multiple).toBe(true)
    expect(selectedValues(modeFirst)).toEqual(['a', 'c'])
    expect(selectedValues(valueFirst)).toEqual(['a', 'c'])
    await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-toggle-select-mode]')!.click(),
    )
    expect(modeFirst.multiple).toBe(false)
    expect(valueFirst.multiple).toBe(false)
    expect(selectedValues(modeFirst)).toEqual(['b'])
    expect(selectedValues(valueFirst)).toEqual(['b'])
  })
})

function mountApp(): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = mountCompiled(DomSemanticsApp, host).dispose
  return host
}

function selectedValues(select: HTMLSelectElement): string[] {
  return [...select.selectedOptions].map((option) => option.value)
}
