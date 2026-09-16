import type { RakutenSearchItem } from '../marketplaceOffers/RakutenSearchDialog'

export const RAKUTEN_CANDIDATE_ATTEMPT_LIMIT = 10

function normalizePartNumber(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

export function selectPartNumberMatchedRakutenItems(items: RakutenSearchItem[], partNumber: string, limit = 5): RakutenSearchItem[] {
  const normalizedPartNumber = normalizePartNumber(partNumber)
  if (!normalizedPartNumber) return []
  return items
    .slice(0, RAKUTEN_CANDIDATE_ATTEMPT_LIMIT)
    .filter(item => normalizePartNumber(item.itemName).includes(normalizedPartNumber))
    .slice(0, limit)
}