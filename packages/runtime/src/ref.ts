export interface MutableRef<T> {
  current: T
}

/** Creates the stable ref cell captured by a component's one-time execution. */
export function useRef<T>(initialValue: T): MutableRef<T> {
  return { current: initialValue }
}
