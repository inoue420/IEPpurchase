/**
 * Normalizes text used by client-side list searches.
 *
 * Normalizing both query and stored text makes full-width and half-width
 * characters behave consistently across master and RFQ screens.
 */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP')
}

export function includesSearchText(value: string, normalizedKeyword: string): boolean {
  return normalizeSearchText(value).includes(normalizedKeyword)
}
