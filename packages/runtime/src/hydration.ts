import {
  HydrationMismatch,
  installHydrationOperations,
  type HydrationRange,
} from './hydration-bridge.ts'

const HYDRATION_PREFIX = 'vidact:v1'

interface HydrationState {
  readonly host: ParentNode
  readonly root: HydrationRange
  readonly components: readonly HydrationRange[]
  readonly claimedElements: WeakSet<Element>
  readonly elements: readonly Element[]
  readonly cursors: WeakMap<Node, Node | null>
  readonly slots: WeakMap<Node, Comment[]>
  componentIndex: number
  claimedElementCount: number
  pendingStructuralParents: number
}

let activeHydration: HydrationState | undefined
let activeInsertionPoint: readonly [parent: Node, before: Node] | undefined
const hydrationFragments = new WeakMap<DocumentFragment, readonly unknown[]>()

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
    claimedElements: new WeakSet(),
    elements: collectPostorderElements(root),
    cursors: new WeakMap([[host as Node, root[0].nextSibling]]),
    slots: new WeakMap(),
    componentIndex: 0,
    claimedElementCount: 0,
    pendingStructuralParents: 0,
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
  if (state.claimedElementCount !== state.elements.length) {
    throw mismatch(
      `claimed ${state.claimedElementCount} of ${state.elements.length} server elements`,
    )
  }
  const rootCursor = cursor(state, state.host as Node)
  if (rootCursor !== state.root[1]) {
    throw mismatch(
      `compiled root did not consume the complete server root range; stopped at ${JSON.stringify(markerValue(rootCursor as Node) ?? rootCursor?.nodeName ?? null)}`,
    )
  }
}

export function hydrationRootMarkers(): HydrationRange {
  return requireHydration().root
}

export function isHydrating(): boolean {
  return activeHydration !== undefined
}

export function createHydrationFragment(children: readonly unknown[]): DocumentFragment {
  const fragment = document.createDocumentFragment()
  hydrationFragments.set(fragment, children)
  return fragment
}

export function hydrationFragmentChildren(
  fragment: DocumentFragment,
): readonly unknown[] | undefined {
  return hydrationFragments.get(fragment)
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
  const matches = state.elements.filter(
    (candidate) =>
      !state.claimedElements.has(candidate) &&
      candidate.localName === localName &&
      candidate.namespaceURI === namespace,
  )
  const element =
    state.pendingStructuralParents > 0
      ? (matches.find(containsArrayMarker) ?? matches[0])
      : matches[0]
  if (element === undefined) throw mismatch(`missing server element <${localName}>`)
  if (state.pendingStructuralParents > 0) state.pendingStructuralParents -= 1
  state.claimedElements.add(element)
  state.claimedElementCount += 1
  state.cursors.set(element, element.firstChild)
  return element
}

export function noteHydrationStructuralParent(): void {
  if (activeHydration !== undefined) activeHydration.pendingStructuralParents += 1
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
  return range
}

export function withHydrationCursor<Result>(
  parent: Node,
  value: Node | null,
  operation: () => Result,
): Result {
  const state = activeHydration
  if (state === undefined) return operation()
  const hadCursor = state.cursors.has(parent)
  const previous = state.cursors.get(parent) ?? null
  state.cursors.set(parent, value)
  try {
    return operation()
  } finally {
    if (hadCursor) state.cursors.set(parent, previous)
    else state.cursors.delete(parent)
  }
}

export function claimHydrationNode(parent: Node, node: Node): boolean {
  const state = activeHydration
  if (state === undefined) return false
  enterHydrationSlot(state, parent)
  const next = cursor(state, parent)
  if (isMarker(next, `${HYDRATION_PREFIX}:s`)) {
    const end = findClosingSibling(next, `${HYDRATION_PREFIX}:s`)
    if (next.nextSibling !== node || node.nextSibling !== end) {
      throw mismatch(`server node range does not contain exactly the expected ${node.nodeName}`)
    }
    setHydrationCursor(state, parent, end.nextSibling)
    return true
  }
  if (next !== node) {
    throw mismatch(`expected existing ${node.nodeName} at the current hydration position`)
  }
  setHydrationCursor(state, parent, node.nextSibling)
  return true
}

export function claimHydrationComponentMount(parent: Node, start: Comment, end: Comment): boolean {
  const state = activeHydration
  if (state === undefined) return false
  enterHydrationSlot(state, parent)
  const current = cursor(state, parent)
  if (
    (current !== start && current !== end) ||
    start.parentNode !== parent ||
    end.parentNode !== parent
  ) {
    throw mismatch('server component range does not match the compiled child position')
  }
  setHydrationCursor(state, parent, end.nextSibling)
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
  enterHydrationSlot(state, parent)
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
  setHydrationCursor(state, parent, end.nextSibling)
  return [start, end, text]
}

export function claimHydrationArrayRange(parent: Node): HydrationRange | undefined {
  const state = activeHydration
  if (state === undefined) return undefined
  enterHydrationSlot(state, parent)
  const start = cursor(state, parent)
  if (!isMarker(start, `${HYDRATION_PREFIX}:a`)) {
    throw mismatch(
      `expected a vidact:v1 array marker in ${parent.nodeName}; found ${JSON.stringify(markerValue(start as Node) ?? start?.nodeName ?? null)}`,
    )
  }
  const end = findClosingSibling(start, `${HYDRATION_PREFIX}:a`)
  state.cursors.set(parent, start.nextSibling)
  return [start, end]
}

export function finishHydrationArrayRange(parent: Node, end: Comment): void {
  const state = requireHydration()
  if (cursor(state, parent) !== end) {
    throw mismatch('compiled collection did not consume its complete server array range')
  }
  setHydrationCursor(state, parent, end.nextSibling)
}

export function claimHydrationSlotRange(parent: Node): HydrationRange | undefined {
  const state = activeHydration
  if (state === undefined) return undefined
  const start = cursor(state, parent)
  if (!isMarker(start, `${HYDRATION_PREFIX}:b`)) {
    throw mismatch('expected a vidact:v1 child-slot marker')
  }
  const end = findClosingSibling(start, `${HYDRATION_PREFIX}:b`)
  const slots = state.slots.get(parent) ?? []
  slots.push(end)
  state.slots.set(parent, slots)
  state.cursors.set(parent, start.nextSibling)
  return [start, end]
}

export function claimHydrationSuspenseFallback(parent: Node): Comment | undefined {
  const state = activeHydration
  if (state === undefined) return undefined
  const marker = cursor(state, parent)
  if (!isMarker(marker, `${HYDRATION_PREFIX}:p`)) return undefined
  setHydrationCursor(state, parent, marker.nextSibling)
  return marker
}

export function withoutHydration<Result>(operation: () => Result): Result {
  const previous = activeHydration
  activeHydration = undefined
  try {
    return operation()
  } finally {
    activeHydration = previous
  }
}

export function withHydrationInsertion<Result>(
  parent: Node,
  before: Node,
  operation: () => Result,
): Result {
  if (activeHydration === undefined) return operation()
  const previous = activeInsertionPoint
  activeInsertionPoint = [parent, before]
  try {
    return operation()
  } finally {
    activeInsertionPoint = previous
  }
}

export function hydrationInsertionPoint(): readonly [parent: Node, before: Node] | undefined {
  return activeInsertionPoint
}

export function hydrationCursor(parent: Node): Node | null | undefined {
  const state = activeHydration
  return state === undefined ? undefined : cursor(state, parent)
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

function enterHydrationSlot(state: HydrationState, parent: Node): void {
  const slots = state.slots.get(parent) ?? []
  let start = cursor(state, parent)
  while (isMarker(start, `${HYDRATION_PREFIX}:b`)) {
    slots.push(findClosingSibling(start, `${HYDRATION_PREFIX}:b`))
    start = start.nextSibling
  }
  if (slots.length !== 0) state.slots.set(parent, slots)
  state.cursors.set(parent, start)
}

function setHydrationCursor(state: HydrationState, parent: Node, value: Node | null): void {
  const slots = state.slots.get(parent)
  let next = value
  if (slots !== undefined) {
    for (;;) {
      const end = slots.at(-1)
      if (end !== next) break
      slots.pop()
      next = end.nextSibling
    }
  }
  state.cursors.set(parent, next)
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
  let depth = 0
  for (let node = start.nextSibling; node !== null; node = node.nextSibling) {
    if (isMarker(node, kind)) {
      depth += 1
      continue
    }
    if (!isMarker(node, `/${kind}`)) continue
    if (depth === 0) return node
    depth -= 1
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
    const match = comment.data.match(/^\/?vidact:v1:([abchrst])$/)
    if (match === null) continue
    const kind = match[1] as 'a' | 'b' | 'c' | 'h' | 'r' | 's' | 't'
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
  components.sort(([left], [right]) => {
    const position = left.compareDocumentPosition(right)
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  })
  return { roots, components }
}

function collectPostorderElements(root: HydrationRange): Element[] {
  const elements: Element[] = []
  const visit = (element: Element): void => {
    visitChildren(element)
    elements.push(element)
  }
  const visitChildren = (parent: Node): void => {
    let opaqueDepth = 0
    for (const child of parent.childNodes) {
      if (isMarker(child, `${HYDRATION_PREFIX}:h`)) {
        opaqueDepth += 1
        continue
      }
      if (isMarker(child, `/${HYDRATION_PREFIX}:h`)) {
        opaqueDepth -= 1
        continue
      }
      if (opaqueDepth === 0 && child instanceof Element) visit(child)
    }
    if (opaqueDepth !== 0) throw mismatch('unbalanced vidact:v1 raw HTML marker range')
  }
  let opaqueDepth = 0
  for (let node = root[0].nextSibling; node !== null && node !== root[1]; node = node.nextSibling) {
    if (isMarker(node, `${HYDRATION_PREFIX}:h`)) {
      opaqueDepth += 1
      continue
    }
    if (isMarker(node, `/${HYDRATION_PREFIX}:h`)) {
      opaqueDepth -= 1
      continue
    }
    if (opaqueDepth === 0 && node instanceof Element) visit(node)
  }
  if (opaqueDepth !== 0) throw mismatch('unbalanced vidact:v1 raw HTML marker range')
  return elements
}

function containsArrayMarker(element: Element): boolean {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_COMMENT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (isMarker(node, `${HYDRATION_PREFIX}:a`)) return true
  }
  return false
}

export function installHydration(): void {
  installHydrationOperations({
    begin: beginHydration,
    finish: finishHydration,
    rootMarkers: hydrationRootMarkers,
    active: isHydrating,
    createFragment: createHydrationFragment,
    fragmentChildren: hydrationFragmentChildren,
    claimElement: claimHydrationElement,
    noteStructuralParent: noteHydrationStructuralParent,
    claimComponentRange: claimHydrationComponentRange,
    withCursor: withHydrationCursor,
    claimNode: claimHydrationNode,
    claimComponentMount: claimHydrationComponentMount,
    claimText: claimHydrationText,
    claimTextRange: claimHydrationTextRange,
    claimArrayRange: claimHydrationArrayRange,
    finishArrayRange: finishHydrationArrayRange,
    claimSlotRange: claimHydrationSlotRange,
    claimSuspenseFallback: claimHydrationSuspenseFallback,
    withoutHydration,
    withInsertion: withHydrationInsertion,
    insertionPoint: hydrationInsertionPoint,
    cursor: hydrationCursor,
    rangeParent: hydrationRangeParent,
  })
}
