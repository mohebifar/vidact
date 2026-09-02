export interface MutableRef<T> {
  current: T
}

/** Creates the plain ref object used by dependency initialization outside component hooks. */
export function createRef<T>(): MutableRef<T | null> {
  return { current: null }
}

/** Creates the stable ref cell captured by a component's one-time execution. */
export function useRef<T>(initialValue: T): MutableRef<T> {
  return { current: initialValue }
}
