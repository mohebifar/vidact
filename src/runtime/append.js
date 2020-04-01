export function append(element, ...children) {
  element.element.append(...children.flatMap(child => child.element));
}
