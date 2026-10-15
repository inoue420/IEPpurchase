export interface DeliveryLocationSelection { deliveryLocationId: string; deliveryLocationName: string }

// Match only equivalent spellings. Similar addresses must be reviewed by a person.
export function normalizeDeliveryLocation(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}
export function deliveryLocationName(value: unknown): string {
  if (typeof value !== 'string' || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value) || [...value.trim()].length > 255) {
    throw new Error('納品場所は改行・制御文字を含まない255文字以内で入力してください。')
  }
  return value.trim()
}
