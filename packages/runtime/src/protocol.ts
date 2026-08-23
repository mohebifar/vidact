export const VIDACT_RUNTIME_PROTOCOL = 'vidact-runtime-v1'

export function assertRuntimeProtocol(expected: string): void {
  if (expected === VIDACT_RUNTIME_PROTOCOL) return
  throw new Error(
    `Vidact compiler/runtime protocol mismatch: compiled for ${expected}, runtime provides ${VIDACT_RUNTIME_PROTOCOL}`,
  )
}
