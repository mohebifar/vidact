/** Local stand-in for a design-system class merger, imported across modules. */
export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}
