export interface MutationCaptureOptions {
  readonly observe?: MutationObserverInit
  readonly settle?: () => void | Promise<void>
}

export interface MutationCapture<Result> {
  readonly result: Result
  readonly records: readonly MutationRecord[]
}

export interface MutationRecorder {
  readonly stop: () => readonly MutationRecord[]
}

export interface MutationRule {
  readonly type: MutationRecord['type']
  readonly target?: Node
  readonly within?: Node
  readonly attributeName?: string
}

const defaultObserverOptions: MutationObserverInit = {
  attributes: true,
  attributeOldValue: true,
  characterData: true,
  characterDataOldValue: true,
  childList: true,
  subtree: true,
}

export async function captureMutations<Result>(
  target: Node,
  action: () => Result | Promise<Result>,
  options: MutationCaptureOptions = {},
): Promise<MutationCapture<Result>> {
  const recorder = startMutationCapture(target, options.observe)

  try {
    const result = await action()
    await options.settle?.()
    await Promise.resolve()
    return { result, records: recorder.stop() }
  } finally {
    recorder.stop()
  }
}

export function startMutationCapture(
  target: Node,
  observe: MutationObserverInit = {},
): MutationRecorder {
  const records: MutationRecord[] = []
  const observer = new MutationObserver((delivered) => records.push(...delivered))
  const observerOptions = { ...defaultObserverOptions, ...observe }
  if (observerOptions.attributes === false) delete observerOptions.attributeOldValue
  if (observerOptions.characterData === false) delete observerOptions.characterDataOldValue
  observer.observe(target, observerOptions)
  let stopped = false

  return {
    stop() {
      if (!stopped) {
        records.push(...observer.takeRecords())
        observer.disconnect()
        stopped = true
      }
      return [...records]
    },
  }
}

export function assertMutationEnvelope(
  records: readonly MutationRecord[],
  allowed: readonly MutationRule[],
  label = 'DOM update',
): void {
  const unexpected = records.filter(
    (record) => !allowed.some((rule) => matchesMutationRule(record, rule)),
  )
  if (unexpected.length === 0) return

  throw new Error(
    [
      `${label} produced ${unexpected.length} unexpected DOM mutation(s):`,
      ...describeMutations(unexpected).map((description) => `- ${description}`),
    ].join('\n'),
  )
}

export function describeMutations(records: readonly MutationRecord[]): string[] {
  return records.map((record) => {
    const target = describeNode(record.target)
    if (record.type === 'attributes') {
      return `attributes ${target} ${record.attributeName ?? '<unknown>'} (was ${JSON.stringify(record.oldValue)})`
    }
    if (record.type === 'characterData') {
      return `characterData ${target} (was ${JSON.stringify(record.oldValue)})`
    }
    return `childList ${target} (+${record.addedNodes.length} -${record.removedNodes.length})`
  })
}

export function requireSingleDirectText(parent: Node, label = describeNode(parent)): Text {
  const texts = [...parent.childNodes].filter((node): node is Text => node instanceof Text)
  if (texts.length === 1) return texts[0]!
  throw new Error(`${label} must contain exactly one direct text node; found ${texts.length}`)
}

function matchesMutationRule(record: MutationRecord, rule: MutationRule): boolean {
  if (record.type !== rule.type) return false
  if (rule.target !== undefined && record.target !== rule.target) return false
  if (rule.within !== undefined && !rule.within.contains(record.target)) return false
  return rule.attributeName === undefined || record.attributeName === rule.attributeName
}

function describeNode(node: Node): string {
  if (node instanceof Element) {
    const id = node.id === '' ? '' : `#${node.id}`
    const classes = [...node.classList].map((className) => `.${className}`).join('')
    return `<${node.localName}${id}${classes}>`
  }
  if (node instanceof Text) return `#text(${JSON.stringify(node.data)})`
  if (node instanceof Comment) return `#comment(${JSON.stringify(node.data)})`
  return node.nodeName
}
