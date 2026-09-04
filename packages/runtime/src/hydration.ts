import {
  HYDRATION_PREFIX,
  HydrationMismatch,
  installHydrationOperations,
  type HydrationRange,
} from './hydration-bridge.ts'

interface HydrationState {
  readonly host: ParentNode
  readonly root: HydrationRange
  readonly components: readonly HydrationRange[]
  readonly claimedElements: WeakSet<Element>
  readonly elementComponents: WeakMap<Element, Comment>
  readonly elements: readonly Element[]
  readonly cursors: WeakMap<Node, Node | null>
  readonly slots: WeakMap<Node, Comment[]>
  componentIndex: number
  claimedElementCount: number
  pendingStructuralParents: number
  activeComponentStart: Comment | undefined
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
    throw mismatch(`expected exactly one ${HYDRATION_PREFIX} root marker range`)
  }
  activeHydration = {
    host,
    root,
    components: ranges.components,
    claimedElements: new WeakSet(),
    elementComponents: collectElementComponents(host),
    elements: collectPostorderElements(root),
    cursors: new WeakMap([[host as Node, root[0].nextSibling]]),
    slots: new WeakMap(),
    componentIndex: 0,
    claimedElementCount: 0,
    pendingStructuralParents: 0,
    activeComponentStart: undefined,
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
  matchesExpected?: (element: Element) => boolean,
): Element | undefined {
  const state = activeHydration
  if (state === undefined) return undefined
  const candidates = state.elements.filter(
    (candidate) =>
      !state.claimedElements.has(candidate) &&
      (state.activeComponentStart === undefined ||
        state.elementComponents.get(candidate) === state.activeComponentStart) &&
      candidate.localName === localName &&
      candidate.namespaceURI === namespace,
  )
  const expectedMatches =
    matchesExpected === undefined ? candidates : candidates.filter(matchesExpected)
  const matches = expectedMatches.length === 0 ? candidates : expectedMatches
  const element =
    state.pendingStructuralParents > 0
      ? (matches.find(containsArrayMarker) ?? matches[0])
      : matches[0]
  if (element === undefined) {
    throw mismatch(
      state.pendingStructuralParents > 0
        ? `missing server structural parent <${localName}>`
        : `missing server element <${localName}>`,
    )
  }
  if (state.pendingStructuralParents > 0) state.pendingStructuralParents = 0
  state.claimedElements.add(element)
  state.claimedElementCount += 1
  state.cursors.set(element, initialCursor(element))
  return element
}

/**
 * Called by a compiled list right before its container element is claimed. Lists are the
 * only structural bindings whose server markup carries an `a` marker, so they are the
 * only ones that may prefer a candidate containing one — for a conditional, Suspense or
 * any other structural child that bias would pick an unrelated element that happens to
 * hold a list (see `claimHydrationElement`).
 */
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

export function withHydrationComponentRange<Result>(
  range: HydrationRange,
  operation: () => Result,
): Result {
  const state = activeHydration
  if (state === undefined) return operation()
  const previous = state.activeComponentStart
  state.activeComponentStart = range[0]
  try {
    return operation()
  } finally {
    state.activeComponentStart = previous
  }
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
  const state = activeHydration
  if (state === undefined) return undefined
  enterHydrationSlot(state, parent)
  return claimTextPrefix(state, parent, expected)
}

/**
 * Claims the text for a scalar binding together with a range it can later swap an
 * element or collection into. The server emits no markers around text, so the binding
 * borrows the enclosing child-slot markers when the slot holds exactly this text — the
 * common case, and no DOM is touched. A text node shared with adjacent scalars (one
 * parsed node for several array items) gets fresh anchor comments instead.
 */
export function claimHydrationTextRange(
  parent: Node,
  expected: string,
): readonly [start: Comment, end: Comment, text: Text | null] | undefined {
  const state = activeHydration
  if (state === undefined) return undefined
  enterHydrationSlot(state, parent)
  const at = cursor(state, parent)
  const slotStart = at === null ? parent.lastChild : at.previousSibling
  const text = claimTextPrefix(state, parent, expected)
  const slotEnd = text === null ? at : text.nextSibling
  if (
    isMarker(slotStart, `${HYDRATION_PREFIX}:b`) &&
    isMarker(slotEnd, `/${HYDRATION_PREFIX}:b`) &&
    findClosingSibling(slotStart, `${HYDRATION_PREFIX}:b`) === slotEnd
  ) {
    return [slotStart, slotEnd, text]
  }
  const start = document.createComment('')
  const end = document.createComment('')
  const reference = text ?? at
  parent.insertBefore(start, reference)
  parent.insertBefore(end, text === null ? reference : text.nextSibling)
  return [start, end, text]
}

/**
 * The server renders a scalar as bare text, and nothing at all for an empty one. Adjacent
 * scalars in one collection parse into a single text node, so a claim takes only its own
 * prefix and splits the rest off for the next claim.
 */
function claimTextPrefix(state: HydrationState, parent: Node, expected: string): Text | null {
  const node = cursor(state, parent)
  if (expected === '') {
    if (node instanceof Text && node.data === '') {
      setHydrationCursor(state, parent, node.nextSibling)
      return node
    }
    // Nothing to consume, but closing slot markers at the cursor still need passing.
    setHydrationCursor(state, parent, node)
    return null
  }
  if (!(node instanceof Text)) {
    throw mismatch(
      `expected server text ${JSON.stringify(expected)} in ${describeNode(parent)}; found ${describeNode(node)}`,
    )
  }
  if (!node.data.startsWith(expected)) {
    throw mismatch(
      `server text ${JSON.stringify(node.data)} does not match ${JSON.stringify(expected)}`,
    )
  }
  if (node.data.length > expected.length) node.splitText(expected.length)
  setHydrationCursor(state, parent, node.nextSibling)
  return node
}

export function claimHydrationArrayRange(parent: Node): HydrationRange | undefined {
  const state = activeHydration
  if (state === undefined) return undefined
  enterHydrationSlot(state, parent)
  const start = cursor(state, parent)
  if (!isMarker(start, `${HYDRATION_PREFIX}:a`)) {
    throw mismatch(
      `expected a ${HYDRATION_PREFIX} array marker in ${describeNode(parent)}; found ${JSON.stringify(markerValue(start as Node) ?? start?.nodeName ?? null)}`,
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
    throw mismatch(
      `expected a ${HYDRATION_PREFIX} child-slot marker in ${describeNode(parent)}; found ${JSON.stringify(markerValue(start as Node) ?? start?.nodeName ?? null)} after ${JSON.stringify(markerValue(start?.previousSibling as Node) ?? start?.previousSibling?.nodeName ?? null)}; insertion=${JSON.stringify(markerValue(activeInsertionPoint?.[1] as Node) ?? activeInsertionPoint?.[1]?.nodeName ?? null)}`,
    )
  }
  const end = findClosingSibling(start, `${HYDRATION_PREFIX}:b`)
  const slots = state.slots.get(parent) ?? []
  slots.push(end)
  state.slots.set(parent, slots)
  state.cursors.set(parent, start.nextSibling)
  return [start, end]
}

export function borrowHydrationSlotRange(
  parent: Node,
  current: boolean,
): HydrationRange | undefined {
  const state = activeHydration
  if (state === undefined) return undefined
  const start = (
    current ? cursor(state, parent) : cursor(state, parent)?.previousSibling
  ) as Node | null
  if (!isMarker(start, `${HYDRATION_PREFIX}:b`)) return undefined
  if (
    !current &&
    activeInsertionPoint?.[0] === parent &&
    isMarker(activeInsertionPoint[1], `/${HYDRATION_PREFIX}:b`)
  ) {
    return [start, activeInsertionPoint[1]]
  }
  return [start, findClosingSibling(start, `${HYDRATION_PREFIX}:b`)]
}

/**
 * Claims everything between two markers as-is, without hydrating into it. A Suspense
 * boundary uses this when the server rendered its content but the client cannot
 * produce it yet (a lazy chunk still loading): the server DOM stays on screen as a
 * dehydrated boundary and the client render replaces it once the resource resolves.
 * The elements and component ranges inside are marked claimed so `finishHydration`'s
 * accounting still balances.
 */
export function skipHydrationRange(start: Comment, end: Comment): void {
  const state = requireHydration()
  const parent = start.parentNode
  if (parent === null || end.parentNode !== parent) throw mismatch('detached server marker range')
  for (const element of collectPostorderElements([start, end])) {
    if (state.claimedElements.has(element)) continue
    state.claimedElements.add(element)
    state.claimedElementCount += 1
  }
  // Component ranges are sorted by document position and every earlier one is already
  // claimed, so the ones inside this range sit contiguously at the current index.
  while (state.componentIndex < state.components.length) {
    const componentStart = state.components[state.componentIndex]![0]
    const inside =
      (start.compareDocumentPosition(componentStart) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
      (componentStart.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    if (!inside) break
    state.componentIndex += 1
  }
  state.pendingStructuralParents = 0
  setHydrationCursor(state, parent, end)
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
  if (!state.cursors.has(parent)) state.cursors.set(parent, initialCursor(parent))
  return state.cursors.get(parent) ?? null
}

function initialCursor(parent: Node): Node | null {
  return parent.firstChild
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

/** `DIV.class-a[data-x]` — enough of an element to find it in the server markup. */
function describeNode(node: Node | null | undefined): string {
  if (!(node instanceof Element)) return node?.nodeName ?? 'null'
  const classes = node.classList.length === 0 ? '' : `.${[...node.classList].join('.')}`
  const data = [...node.attributes]
    .filter((attribute) => attribute.name.startsWith('data-') || attribute.name === 'id')
    .map((attribute) => `[${attribute.name}]`)
    .join('')
  return `${node.nodeName}${classes}${data}`
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

/** Paired markers; `p` (pending fallback) is a lone marker and stays out of the stacks. */
const RANGE_MARKER = new RegExp(`^\\/?${HYDRATION_PREFIX}:([abchr])$`)

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
    const match = RANGE_MARKER.exec(comment.data)
    if (match === null) continue
    const kind = match[1] as 'a' | 'b' | 'c' | 'h' | 'r'
    if (!comment.data.startsWith('/')) {
      const stack = stacks.get(kind) ?? []
      stack.push(comment)
      stacks.set(kind, stack)
      continue
    }
    const start = stacks.get(kind)?.pop()
    if (start === undefined) throw mismatch(`orphan closing ${HYDRATION_PREFIX}:${kind} marker`)
    if (kind === 'r') roots.push([start, comment])
    if (kind === 'c') components.push([start, comment])
  }
  if ([...stacks.values()].some((stack) => stack.length !== 0)) {
    throw mismatch(`unclosed ${HYDRATION_PREFIX} hydration marker`)
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
    if (opaqueDepth !== 0) throw mismatch(`unbalanced ${HYDRATION_PREFIX} raw HTML marker range`)
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
  if (opaqueDepth !== 0) throw mismatch(`unbalanced ${HYDRATION_PREFIX} raw HTML marker range`)
  return elements
}

function collectElementComponents(host: ParentNode): WeakMap<Element, Comment> {
  const owners = new WeakMap<Element, Comment>()
  const components: Comment[] = []
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (isMarker(node, `${HYDRATION_PREFIX}:c`)) {
      components.push(node)
      continue
    }
    if (isMarker(node, `/${HYDRATION_PREFIX}:c`)) {
      components.pop()
      continue
    }
    if (node instanceof Element) {
      const owner = components.at(-1)
      if (owner !== undefined) owners.set(node, owner)
    }
  }
  return owners
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
    withComponentRange: withHydrationComponentRange,
    withCursor: withHydrationCursor,
    claimNode: claimHydrationNode,
    claimComponentMount: claimHydrationComponentMount,
    claimText: claimHydrationText,
    claimTextRange: claimHydrationTextRange,
    claimArrayRange: claimHydrationArrayRange,
    finishArrayRange: finishHydrationArrayRange,
    claimSlotRange: claimHydrationSlotRange,
    borrowSlotRange: borrowHydrationSlotRange,
    claimSuspenseFallback: claimHydrationSuspenseFallback,
    skipRange: skipHydrationRange,
    withoutHydration,
    withInsertion: withHydrationInsertion,
    insertionPoint: hydrationInsertionPoint,
    cursor: hydrationCursor,
    rangeParent: hydrationRangeParent,
  })
}
