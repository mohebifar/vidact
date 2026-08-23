const HYDRATION_PREFIX = 'vidact:v1'

type HydrationRange = readonly [start: Comment, end: Comment]

interface HydrationState {
  readonly host: ParentNode
  readonly root: HydrationRange
  readonly components: readonly HydrationRange[]
  readonly elements: readonly Element[]
  readonly cursors: WeakMap<Node, Node | null>
  componentIndex: number
  elementIndex: number
}

export interface HydrationMismatchInfo {
  readonly message: string
}

export class HydrationMismatch extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HydrationMismatch'
  }
}

let activeHydration: HydrationState | undefined

export function beginHydration(host: ParentNode): () => void {
  if (activeHydration !== undefined) {
    throw new Error('a Vidact hydration is already active')
  }
  const ranges = scanRanges(host)
  const root = ranges.roots[0]
  if (root === undefined || ranges.roots.length !== 1) {
    throw mismatch('expected exactly one vidact:v1 root marker range')
  }
  activeHydration = {
    host,
    root,
    components: ranges.components,
    elements: collectPostorderElements(root),
    cursors: new WeakMap([[host as Node, root[0].nextSibling]]),
    componentIndex: 0,
    elementIndex: 0,
  }
  return () => {
    activeHydration = undefined
  }
}

export function finishHydration(): void {
  const state = requireHydration()
  if (state.componentIndex !== state.components.length) {
    throw mismatch(
      `claimed ${state.componentIndex} of ${state.components.length} server component ranges`,
    )
  }
  if (state.elementIndex !== state.elements.length) {
    throw mismatch(`claimed ${state.elementIndex} of ${state.elements.length} server elements`)
  }
  if (cursor(state, state.host as Node) !== state.root[1]) {
    throw mismatch('compiled root did not consume the complete server root range')
  }
}

export function hydrationRootMarkers(): HydrationRange {
  return requireHydration().root
}

export function isHydrating(): boolean {
  return activeHydration !== undefined
}

export function isHydrationMismatch(error: unknown): error is HydrationMismatch {
  return error instanceof HydrationMismatch
}

export function claimHydrationElement(
  localName: string,
  namespace: string | null,
): Element | undefined {
  const state = activeHydration
  if (state === undefined) return undefined
  const element = state.elements[state.elementIndex]
  if (element === undefined) throw mismatch(`missing server element <${localName}>`)
  if (element.localName !== localName || element.namespaceURI !== namespace) {
    throw mismatch(`expected <${localName}> but found <${element.localName}> during hydration`)
  }
  state.elementIndex += 1
  state.cursors.set(element, element.firstChild)
  return element
}

export function claimHydrationComponentRange(): HydrationRange | undefined {
  const state = activeHydration
  if (state === undefined) return undefined
  const range = state.components[state.componentIndex]
  if (range === undefined) throw mismatch('missing server component marker range')
  state.componentIndex += 1
  const parent = range[0].parentNode
  if (parent === null || range[1].parentNode !== parent) {
    throw mismatch('server component marker range is detached')
  }
  state.cursors.set(parent, range[0].nextSibling)
  return range
}

export function claimHydrationNode(parent: Node, node: Node): boolean {
  const state = activeHydration
  if (state === undefined) return false
  const next = cursor(state, parent)
  if (next !== node) {
    throw mismatch(`expected existing ${node.nodeName} at the current hydration position`)
  }
  state.cursors.set(parent, node.nextSibling)
  return true
}

export function claimHydrationComponentMount(parent: Node, start: Comment, end: Comment): boolean {
  const state = activeHydration
  if (state === undefined) return false
  const current = cursor(state, parent)
  if (
    (current !== start && current !== end) ||
    start.parentNode !== parent ||
    end.parentNode !== parent
  ) {
    throw mismatch('server component range does not match the compiled child position')
  }
  state.cursors.set(parent, end.nextSibling)
  return true
}

export function claimHydrationText(parent: Node, expected: string): Text | null | undefined {
  return claimHydrationTextRange(parent, expected)?.[2]
}

export function claimHydrationTextRange(
  parent: Node,
  expected: string,
): readonly [start: Comment, end: Comment, text: Text | null] | undefined {
  const state = activeHydration
  if (state === undefined) return undefined
  const start = cursor(state, parent)
  if (!isMarker(start, `${HYDRATION_PREFIX}:t`)) {
    throw mismatch('expected a vidact:v1 text marker')
  }
  const end = findClosingSibling(start, `${HYDRATION_PREFIX}:t`)
  const nodes: Node[] = []
  for (let node = start.nextSibling; node !== null && node !== end; node = node.nextSibling) {
    nodes.push(node)
  }
  if (nodes.length > 1 || (nodes.length === 1 && !(nodes[0] instanceof Text))) {
    throw mismatch('server text marker must contain at most one text node')
  }
  const text = (nodes[0] as Text | undefined) ?? null
  if ((text?.data ?? '') !== expected) {
    throw mismatch(
      `server text ${JSON.stringify(text?.data ?? '')} does not match ${JSON.stringify(expected)}`,
    )
  }
  state.cursors.set(parent, end.nextSibling)
  return [start, end, text]
}

export function hydrationRangeParent(start: Comment, end: Comment): Node | undefined {
  if (activeHydration === undefined) return undefined
  const parent = start.parentNode
  if (parent === null || end.parentNode !== parent) throw mismatch('detached server marker range')
  return parent
}

function requireHydration(): HydrationState {
  if (activeHydration === undefined) throw new Error('no Vidact hydration is active')
  return activeHydration
}

function cursor(state: HydrationState, parent: Node): Node | null {
  if (!state.cursors.has(parent)) state.cursors.set(parent, parent.firstChild)
  return state.cursors.get(parent) ?? null
}

function mismatch(message: string): HydrationMismatch {
  return new HydrationMismatch(message)
}

function markerValue(node: Node): string | undefined {
  return node instanceof Comment ? node.data : undefined
}

function isMarker(node: Node | null, value: string): node is Comment {
  return markerValue(node as Node) === value
}

function findClosingSibling(start: Comment, kind: string): Comment {
  for (let node = start.nextSibling; node !== null; node = node.nextSibling) {
    if (isMarker(node, `/${kind}`)) return node
  }
  throw mismatch(`missing closing ${kind} marker`)
}

function scanRanges(host: ParentNode): {
  roots: HydrationRange[]
  components: HydrationRange[]
} {
  const roots: HydrationRange[] = []
  const components: HydrationRange[] = []
  const stacks = new Map<string, Comment[]>()
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_COMMENT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const comment = node as Comment
    const match = comment.data.match(/^\/?vidact:v1:([crt])$/)
    if (match === null) continue
    const kind = match[1] as 'c' | 'r' | 't'
    if (!comment.data.startsWith('/')) {
      const stack = stacks.get(kind) ?? []
      stack.push(comment)
      stacks.set(kind, stack)
      continue
    }
    const start = stacks.get(kind)?.pop()
    if (start === undefined) throw mismatch(`orphan closing vidact:v1:${kind} marker`)
    if (kind === 'r') roots.push([start, comment])
    if (kind === 'c') components.push([start, comment])
  }
  if ([...stacks.values()].some((stack) => stack.length !== 0)) {
    throw mismatch('unclosed vidact:v1 hydration marker')
  }
  return { roots, components }
}

function collectPostorderElements(root: HydrationRange): Element[] {
  const elements: Element[] = []
  const visit = (element: Element): void => {
    for (const child of element.children) visit(child)
    elements.push(element)
  }
  for (let node = root[0].nextSibling; node !== null && node !== root[1]; node = node.nextSibling) {
    if (node instanceof Element) visit(node)
  }
  return elements
}
