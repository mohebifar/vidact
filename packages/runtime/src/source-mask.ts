const BITS_PER_WORD = 32

export type SourceMask = number | Uint32Array

export function source(index: number): SourceMask {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError(`source index must be a non-negative safe integer, received ${index}`)
  }

  const word = Math.floor(index / BITS_PER_WORD)
  const bit = (1 << (index % BITS_PER_WORD)) >>> 0
  if (word === 0) return bit

  const words = new Uint32Array(word + 1)
  words[word] = bit
  return words
}

export function combineSources(...masks: readonly SourceMask[]): SourceMask {
  const length = masks.reduce<number>(
    (maximum, mask) => Math.max(maximum, wordLength(mask)),
    1,
  )
  if (length === 1) {
    let combined = 0
    for (const mask of masks) combined = (combined | wordAt(mask, 0)) >>> 0
    return combined
  }

  const combined = new Uint32Array(length)
  for (const mask of masks) {
    for (let index = 0; index < wordLength(mask); index += 1) {
      combined[index] = ((combined[index] ?? 0) | wordAt(mask, index)) >>> 0
    }
  }
  return combined
}

export function intersectsSources(left: SourceMask, right: SourceMask): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    return ((left & right) >>> 0) !== 0
  }

  const leftLength = wordLength(left)
  const rightLength = wordLength(right)
  const length = Math.min(leftLength, rightLength)
  for (let index = 0; index < length; index += 1) {
    if (((wordAt(left, index) & wordAt(right, index)) >>> 0) !== 0) return true
  }
  return false
}

export function isEmptySources(mask: SourceMask): boolean {
  if (typeof mask === 'number') return mask === 0
  for (const word of mask) {
    if (word !== 0) return false
  }
  return true
}

export function unionSources(left: SourceMask, right: SourceMask): SourceMask {
  if (typeof left === 'number' && typeof right === 'number') {
    return (left | right) >>> 0
  }

  const leftLength = wordLength(left)
  const rightLength = wordLength(right)
  const length = Math.max(leftLength, rightLength)
  const words = new Uint32Array(length)
  for (let index = 0; index < length; index += 1) {
    words[index] = (wordAt(left, index) | wordAt(right, index)) >>> 0
  }
  return words
}

function wordAt(mask: SourceMask, index: number): number {
  if (typeof mask === 'number') return index === 0 ? mask : 0
  return mask[index] ?? 0
}

function wordLength(mask: SourceMask): number {
  return typeof mask === 'number' ? 1 : mask.length
}
