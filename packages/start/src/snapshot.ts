import {
  decodeFrameworkValue,
  encodeFrameworkValue,
  type FrameworkValue,
} from '@vidact/runtime/framework/protocol'

export const VIDACT_START_PROTOCOL = 'vidact-start-v1'
export const VIDACT_START_NAVIGATION_HEADER = 'x-vidact-start-navigation'
export const VIDACT_START_SNAPSHOT_MEDIA_TYPE = 'application/x-vidact-start+json'

export interface StartSnapshot {
  readonly protocol: typeof VIDACT_START_PROTOCOL
  readonly loaderData: Readonly<Record<string, FrameworkValue>>
  readonly pathname: string
}

export function encodeStartSnapshot(snapshot: StartSnapshot): string {
  return encodeFrameworkValue(snapshot as unknown as FrameworkValue)
}

export function decodeStartSnapshot(payload: string): StartSnapshot {
  const value = decodeFrameworkValue(payload)
  if (
    !isRecord(value) ||
    value.protocol !== VIDACT_START_PROTOCOL ||
    typeof value.pathname !== 'string' ||
    !isRecord(value.loaderData)
  ) {
    throw new TypeError('invalid Vidact Start snapshot')
  }
  return {
    protocol: VIDACT_START_PROTOCOL,
    pathname: value.pathname,
    loaderData: value.loaderData as Readonly<Record<string, FrameworkValue>>,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
