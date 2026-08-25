import { abortReason, withAbort } from './shared/promise.ts'

const CLIENT_REFERENCE = Symbol('Vidact.ClientReference')
const SERVER_REFERENCE = Symbol('Vidact.ServerReference')

export const VIDACT_FRAMEWORK_PROTOCOL = 'vidact-framework-v1'

export interface ClientReference {
  readonly [CLIENT_REFERENCE]: true
  readonly id: string
  readonly exportName: string
}

export interface ServerFunctionReference {
  readonly [SERVER_REFERENCE]: true
  readonly id: string
  readonly bound: readonly FrameworkValue[]
}

export type FrameworkValue =
  | null
  | undefined
  | boolean
  | string
  | number
  | bigint
  | readonly FrameworkValue[]
  | { readonly [key: string]: FrameworkValue }
  | ClientReference
  | ServerFunctionReference

export interface ClientModuleManifest {
  readonly has: (id: string, exportName: string) => boolean
}

export interface ServerFunctionRegistry {
  readonly invoke: (
    id: string,
    arguments_: readonly FrameworkValue[],
    signal?: AbortSignal,
  ) => Promise<FrameworkValue>
  readonly register: (
    id: string,
    implementation: (
      ...arguments_: FrameworkValue[]
    ) => FrameworkValue | PromiseLike<FrameworkValue>,
  ) => () => void
}

type EncodedValue =
  | null
  | boolean
  | string
  | number
  | readonly EncodedValue[]
  | { readonly [key: string]: EncodedValue }

interface FrameworkEnvelope {
  readonly protocol: typeof VIDACT_FRAMEWORK_PROTOCOL
  readonly checksum: string
  readonly body: string
}

interface TraversalBudget {
  nodes: number
}

const MAX_FRAMEWORK_PAYLOAD_CHARACTERS = 64 * 1024 * 1024
const MAX_FRAMEWORK_BODY_CHARACTERS = 32 * 1024 * 1024
const MAX_FRAMEWORK_VALUE_DEPTH = 100
const MAX_FRAMEWORK_VALUE_NODES = 100_000

export function createClientReference(id: string, exportName = 'default'): ClientReference {
  assertReferencePart(id, 'client module id')
  assertReferencePart(exportName, 'client export name')
  return Object.freeze({ [CLIENT_REFERENCE]: true as const, id, exportName })
}

export function createServerFunctionReference(
  id: string,
  bound: readonly FrameworkValue[] = [],
): ServerFunctionReference {
  assertReferencePart(id, 'server function id')
  return Object.freeze({ [SERVER_REFERENCE]: true as const, id, bound: Object.freeze([...bound]) })
}

export function createClientModuleManifest(
  references: Readonly<Record<string, readonly string[]>>,
): ClientModuleManifest {
  const allowed = new Set<string>()
  for (const [id, exports] of Object.entries(references)) {
    assertReferencePart(id, 'client module id')
    for (const exportName of exports) {
      assertReferencePart(exportName, 'client export name')
      allowed.add(`${id}\0${exportName}`)
    }
  }
  const manifest: ClientModuleManifest = {
    has: (id: string, exportName: string) => allowed.has(`${id}\0${exportName}`),
  }
  return Object.freeze(manifest)
}

export function createServerFunctionRegistry(): ServerFunctionRegistry {
  const functions = new Map<
    string,
    (...arguments_: FrameworkValue[]) => FrameworkValue | PromiseLike<FrameworkValue>
  >()
  return {
    register(id, implementation) {
      assertReferencePart(id, 'server function id')
      if (functions.has(id)) throw new Error(`server function ${id} is already registered`)
      functions.set(id, implementation)
      return () => {
        if (functions.get(id) === implementation) functions.delete(id)
      }
    },
    async invoke(id, arguments_, signal) {
      if (signal?.aborted) throw abortReason(signal)
      const implementation = functions.get(id)
      if (implementation === undefined) throw new Error(`unknown server function ${id}`)
      const operation = Promise.resolve(implementation(...arguments_))
      const result = signal === undefined ? await operation : await withAbort(operation, signal)
      assertFrameworkValue(result)
      return result
    },
  }
}

export function encodeFrameworkValue(
  value: FrameworkValue,
  manifest?: ClientModuleManifest,
): string {
  const body = JSON.stringify(encodeValue(value, manifest, new Set(), { nodes: 0 }, 0))
  assertFrameworkPayloadSize(body, MAX_FRAMEWORK_BODY_CHARACTERS, 'body')
  const payload = JSON.stringify({
    protocol: VIDACT_FRAMEWORK_PROTOCOL,
    checksum: checksum(body),
    body,
  } satisfies FrameworkEnvelope)
  assertFrameworkPayloadSize(payload, MAX_FRAMEWORK_PAYLOAD_CHARACTERS, 'envelope')
  return payload
}

export function decodeFrameworkValue(
  payload: string,
  manifest?: ClientModuleManifest,
): FrameworkValue {
  assertFrameworkPayloadSize(payload, MAX_FRAMEWORK_PAYLOAD_CHARACTERS, 'envelope')
  const envelope = JSON.parse(payload) as Partial<FrameworkEnvelope>
  if (
    envelope.protocol !== VIDACT_FRAMEWORK_PROTOCOL ||
    typeof envelope.body !== 'string' ||
    typeof envelope.checksum !== 'string'
  ) {
    throw new Error('unsupported Vidact framework payload')
  }
  if (checksum(envelope.body) !== envelope.checksum) {
    throw new Error('Vidact framework payload integrity check failed')
  }
  assertFrameworkPayloadSize(envelope.body, MAX_FRAMEWORK_BODY_CHARACTERS, 'body')
  return decodeValue(JSON.parse(envelope.body) as EncodedValue, manifest, { nodes: 0 }, 0)
}

export function invokeServerFunctionPayload(
  registry: ServerFunctionRegistry,
  payload: string,
  signal?: AbortSignal,
): Promise<string> {
  const request = decodeFrameworkValue(payload)
  if (!isPlainObject(request) || typeof request.id !== 'string' || !Array.isArray(request.args)) {
    return Promise.reject(new TypeError('invalid server function request payload'))
  }
  return registry
    .invoke(request.id, request.args, signal)
    .then((result) => encodeFrameworkValue(result))
}

function encodeValue(
  value: FrameworkValue,
  manifest: ClientModuleManifest | undefined,
  ancestors: Set<object>,
  budget: TraversalBudget,
  depth: number,
): EncodedValue {
  consumeTraversalBudget(budget, depth)
  if (value === undefined) return { $vidact: 'undefined' }
  if (typeof value === 'bigint') return { $vidact: 'bigint', value: String(value) }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('framework values require finite numbers')
    return value
  }
  if (isClientReference(value)) {
    if (manifest !== undefined && !manifest.has(value.id, value.exportName)) {
      throw new Error(`client reference ${value.id}#${value.exportName} is not in the manifest`)
    }
    return { $vidact: 'client', id: value.id, exportName: value.exportName }
  }
  if (isServerFunctionReference(value)) {
    return {
      $vidact: 'server-function',
      id: value.id,
      bound: encodeValue(value.bound, manifest, ancestors, budget, depth + 1),
    }
  }
  if (typeof value !== 'object') throw new TypeError('unsupported framework value')
  if (ancestors.has(value)) throw new TypeError('framework values cannot contain cycles')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => encodeValue(item, manifest, ancestors, budget, depth + 1))
    }
    if (!isPlainObject(value)) throw new TypeError('framework objects must use a plain prototype')
    return {
      $vidact: 'object',
      entries: Object.entries(value).map(([key, item]) => {
        assertSafeKey(key)
        return [key, encodeValue(item, manifest, ancestors, budget, depth + 1)]
      }),
    }
  } finally {
    ancestors.delete(value)
  }
}

function decodeValue(
  value: EncodedValue,
  manifest: ClientModuleManifest | undefined,
  budget: TraversalBudget,
  depth: number,
): FrameworkValue {
  consumeTraversalBudget(budget, depth)
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('framework values require finite numbers')
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => decodeValue(item, manifest, budget, depth + 1))
  }
  if (!isPlainObject(value)) throw new TypeError('invalid framework value')
  const tag = value.$vidact
  if (tag === 'undefined') return undefined
  if (tag === 'bigint' && typeof value.value === 'string') return BigInt(value.value)
  if (tag === 'client' && typeof value.id === 'string' && typeof value.exportName === 'string') {
    if (manifest !== undefined && !manifest.has(value.id, value.exportName)) {
      throw new Error(`client reference ${value.id}#${value.exportName} is not in the manifest`)
    }
    return createClientReference(value.id, value.exportName)
  }
  if (tag === 'server-function' && typeof value.id === 'string' && Array.isArray(value.bound)) {
    return createServerFunctionReference(
      value.id,
      value.bound.map((item) => decodeValue(item, manifest, budget, depth + 1)),
    )
  }
  if (tag === 'object' && Array.isArray(value.entries)) {
    const output: Record<string, FrameworkValue> = Object.create(null) as Record<
      string,
      FrameworkValue
    >
    for (const entry of value.entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
        throw new TypeError('invalid framework object entry')
      }
      const [key, item] = entry
      assertSafeKey(key)
      output[key] = decodeValue(item, manifest, budget, depth + 1)
    }
    return output
  }
  if (tag !== undefined) throw new TypeError(`invalid framework value tag ${String(tag)}`)
  const output: Record<string, FrameworkValue> = Object.create(null) as Record<
    string,
    FrameworkValue
  >
  for (const [key, item] of Object.entries(value)) {
    assertSafeKey(key)
    output[key] = decodeValue(item, manifest, budget, depth + 1)
  }
  return output
}

function assertFrameworkValue(value: unknown): asserts value is FrameworkValue {
  encodeFrameworkValue(value as FrameworkValue)
}

export function isClientReference(value: unknown): value is ClientReference {
  return typeof value === 'object' && value !== null && CLIENT_REFERENCE in value
}

function isServerFunctionReference(value: unknown): value is ServerFunctionReference {
  return typeof value === 'object' && value !== null && SERVER_REFERENCE in value
}

function isPlainObject(value: unknown): value is Record<string, FrameworkValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function assertSafeKey(key: string): void {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw new TypeError(`unsafe framework object key ${key}`)
  }
}

function consumeTraversalBudget(budget: TraversalBudget, depth: number): void {
  if (depth > MAX_FRAMEWORK_VALUE_DEPTH) {
    throw new RangeError(`framework values cannot exceed depth ${MAX_FRAMEWORK_VALUE_DEPTH}`)
  }
  budget.nodes += 1
  if (budget.nodes > MAX_FRAMEWORK_VALUE_NODES) {
    throw new RangeError(`framework values cannot exceed ${MAX_FRAMEWORK_VALUE_NODES} nodes`)
  }
}

function assertFrameworkPayloadSize(value: string, limit: number, label: string): void {
  if (value.length > limit) {
    throw new RangeError(`Vidact framework payload ${label} exceeds ${limit} characters`)
  }
}

function assertReferencePart(value: string, label: string): void {
  if (value.length === 0 || value.includes('\0')) throw new TypeError(`${label} must be non-empty`)
}

function checksum(value: string): string {
  let hash = 0x81_1c_9d_c5
  for (const byte of new TextEncoder().encode(value)) {
    hash = Math.imul(hash ^ byte, 0x01_00_01_93)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
