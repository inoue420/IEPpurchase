import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../firebase/firebase'

export interface RakutenSearchItem { itemCode: string; itemName: string; itemPrice: number; itemUrl: string; shopName: string; taxFlag: number | null; postageFlag: number | null; availability: number | null }
export interface RakutenSearchResult { items: RakutenSearchItem[]; retrievedAt: string }

const searchItems = httpsCallable<{ keyword: string }, RakutenSearchResult>(firebaseFunctions, 'searchRakutenItems', { timeout: 30000 })

export async function searchRakutenItems(keyword: string): Promise<RakutenSearchResult> {
  return (await searchItems({ keyword: keyword.trim() })).data
}