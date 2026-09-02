export function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter((value) => Boolean(value)).join(' ')
}
