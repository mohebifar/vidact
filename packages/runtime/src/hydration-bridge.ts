export type HydrationRange = readonly [start: Comment, end: Comment]

export interface HydrationOperations {
  readonly begin: (host: ParentNode) => () => void
  readonly finish: () => void
  readonly rootMarkers: () => HydrationRange
  readonly active: () => boolean
  readonly createFragment: (children: readonly unknown[]) => DocumentFragment
  readonly fragmentChildren: (fragment: DocumentFragment) => readonly unknown[] | undefined
  readonly claimElement: (
    localName: string,
    namespace: string | null,
    matches?: (element: Element) => boolean,
  ) => Element | undefined
  readonly noteStructuralParent: () => void
  readonly claimComponentRange: () => HydrationRange | undefined
  readonly withComponentRange: <Result>(range: HydrationRange, operation: () => Result) => Result
  readonly withCursor: <Result>(parent: Node, value: Node | null, operation: () => Result) => Result
  readonly claimNode: (parent: Node, node: Node) => boolean
  readonly claimComponentMount: (parent: Node, start: Comment, end: Comment) => boolean
  readonly claimText: (parent: Node, expected: string) => Text | null | undefined
  readonly claimTextRange: (
    parent: Node,
    expected: string,
  ) => readonly [start: Comment, end: Comment, text: Text | null] | undefined
  readonly claimArrayRange: (parent: Node) => HydrationRange | undefined
  readonly finishArrayRange: (parent: Node, end: Comment) => void
  readonly claimSlotRange: (parent: Node) => HydrationRange | undefined
  readonly borrowSlotRange: (parent: Node, current: boolean) => HydrationRange | undefined
  readonly claimSuspenseFallback: (parent: Node) => Comment | undefined
  readonly skipRange: (start: Comment, end: Comment) => void
  readonly withoutHydration: <Result>(operation: () => Result) => Result
  readonly withInsertion: <Result>(parent: Node, before: Node, operation: () => Result) => Result
  readonly insertionPoint: () => readonly [parent: Node, before: Node] | undefined
  readonly cursor: (parent: Node) => Node | null | undefined
  readonly rangeParent: (start: Comment, end: Comment) => Node | undefined
}

export interface HydrationMismatchInfo {
  readonly message: string
}

/**
 * Marker comment prefix of the server ↔ hydrate protocol (`<!--v2:b-->` … `<!--/v2:b-->`).
 * Bumped whenever the set of markers or their meaning changes, so a stale server render
 * fails hydration loudly instead of being claimed wrongly. `v2` dropped the per-element
 * and per-text markers of `vidact:v1`; the hydrator infers those from the DOM.
 */
export const HYDRATION_PREFIX = 'v2'

export class HydrationMismatch extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HydrationMismatch'
  }
}

let hydration: HydrationOperations | undefined

export function beginHydration(host: ParentNode): () => void {
  if (hydration === undefined) throw new Error('hydrate runtime entry is not installed')
  return hydration.begin(host)
}

export function finishHydration(): void {
  hydration?.finish()
}

export function hydrationRootMarkers(): HydrationRange {
  if (hydration === undefined) throw new Error('hydrate runtime entry is not installed')
  return hydration.rootMarkers()
}

export function isHydrating(): boolean {
  return hydration?.active() ?? false
}

export function createHydrationFragment(children: readonly unknown[]): DocumentFragment {
  if (hydration === undefined) throw new Error('hydrate runtime entry is not installed')
  return hydration.createFragment(children)
}

export function hydrationFragmentChildren(
  fragment: DocumentFragment,
): readonly unknown[] | undefined {
  return hydration?.fragmentChildren(fragment)
}

export function claimHydrationElement(
  localName: string,
  namespace: string | null,
  matches?: (element: Element) => boolean,
): Element | undefined {
  return hydration?.claimElement(localName, namespace, matches)
}

export function noteHydrationStructuralParent(): void {
  hydration?.noteStructuralParent()
}

export function claimHydrationComponentRange(): HydrationRange | undefined {
  return hydration?.claimComponentRange()
}

export function withHydrationComponentRange<Result>(
  range: HydrationRange,
  operation: () => Result,
): Result {
  return hydration === undefined ? operation() : hydration.withComponentRange(range, operation)
}

export function withHydrationCursor<Result>(
  parent: Node,
  value: Node | null,
  operation: () => Result,
): Result {
  return hydration === undefined ? operation() : hydration.withCursor(parent, value, operation)
}

export function claimHydrationNode(parent: Node, node: Node): boolean {
  return hydration?.claimNode(parent, node) ?? false
}

export function claimHydrationComponentMount(parent: Node, start: Comment, end: Comment): boolean {
  return hydration?.claimComponentMount(parent, start, end) ?? false
}

export function claimHydrationText(parent: Node, expected: string): Text | null | undefined {
  return hydration?.claimText(parent, expected)
}

export function claimHydrationTextRange(
  parent: Node,
  expected: string,
): readonly [start: Comment, end: Comment, text: Text | null] | undefined {
  return hydration?.claimTextRange(parent, expected)
}

export function claimHydrationArrayRange(parent: Node): HydrationRange | undefined {
  return hydration?.claimArrayRange(parent)
}

export function finishHydrationArrayRange(parent: Node, end: Comment): void {
  hydration?.finishArrayRange(parent, end)
}

export function claimHydrationSlotRange(parent: Node): HydrationRange | undefined {
  return hydration?.claimSlotRange(parent)
}

export function borrowHydrationSlotRange(
  parent: Node,
  current: boolean,
): HydrationRange | undefined {
  return hydration?.borrowSlotRange(parent, current)
}

export function claimHydrationSuspenseFallback(parent: Node): Comment | undefined {
  return hydration?.claimSuspenseFallback(parent)
}

export function skipHydrationRange(start: Comment, end: Comment): void {
  hydration?.skipRange(start, end)
}

export function withoutHydration<Result>(operation: () => Result): Result {
  return hydration === undefined ? operation() : hydration.withoutHydration(operation)
}

export function withHydrationInsertion<Result>(
  parent: Node,
  before: Node,
  operation: () => Result,
): Result {
  return hydration === undefined ? operation() : hydration.withInsertion(parent, before, operation)
}

export function hydrationInsertionPoint(): readonly [parent: Node, before: Node] | undefined {
  return hydration?.insertionPoint()
}

export function hydrationCursor(parent: Node): Node | null | undefined {
  return hydration?.cursor(parent)
}

export function hydrationRangeParent(start: Comment, end: Comment): Node | undefined {
  return hydration?.rangeParent(start, end)
}

export function isHydrationMismatch(error: unknown): error is HydrationMismatch {
  return error instanceof HydrationMismatch
}

export function installHydrationOperations(operations: HydrationOperations): void {
  hydration = operations
}
