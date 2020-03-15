export function append(el, ...children) {
    el.append(...children.flatMap(a => a));
}