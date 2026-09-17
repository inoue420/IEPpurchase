import { Timestamp, collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, writeBatch, type Unsubscribe } from 'firebase/firestore'
import { firestore } from '../../firebase/firebase'
import { ecPurchaseCandidateSchema, rfqItemSchema, type RfqItemStatus } from './rfqItemSchema'

export interface EcPurchaseCandidate { storeProductName: string; url: string; price: number; purchasePlanned: boolean }
export interface RfqItemInput { originalDescription: string; translatedDescription: string; productId: string; manufacturerId: string; manufacturerName: string; partNumber: string; productName: string; quantity: number; supplierResponseUnitPrice: number | null; unit: string; supplierQuoteRequestEnabled: boolean; marketplaceOfferEnabled: boolean; ecPurchaseCandidates: EcPurchaseCandidate[]; requestedDeliveryDate: string; status: RfqItemStatus; note: string }
export interface RfqItemDocument extends Omit<RfqItemInput, 'requestedDeliveryDate'> { lineNo: number; requestedDeliveryDate: Timestamp | null; createdAt: Timestamp | null; updatedAt: Timestamp | null; archivedAt: Timestamp | null }
export interface RfqItem extends RfqItemDocument { id: string }
export interface RfqItemProduct { id: string; manufacturerId: string; manufacturerName: string; partNumber: string; name: string; unit: string; active: boolean }
const asText = (value: unknown): string => typeof value === 'string' ? value : ''
const asNumber = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
const asTimestamp = (value: unknown): Timestamp | null => value instanceof Timestamp ? value : null
function readEcPurchaseCandidates(value: unknown): EcPurchaseCandidate[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 10).flatMap(candidate => {
    if (candidate === null || typeof candidate !== 'object') return []
    const data = candidate as Record<string, unknown>
    const price = asNumber(data.price)
    return typeof data.storeProductName === 'string' && typeof data.url === 'string' && Number.isInteger(price) ? [{ storeProductName: data.storeProductName, url: data.url, price, purchasePlanned: data.purchasePlanned === true }] : []
  })
}
function readItem(id: string, data: Record<string, unknown>): RfqItem {
  return { id, lineNo: asNumber(data.lineNo), originalDescription: asText(data.originalDescription), translatedDescription: asText(data.translatedDescription), productId: asText(data.productId), manufacturerId: asText(data.manufacturerId), manufacturerName: asText(data.manufacturerName), partNumber: asText(data.partNumber), productName: asText(data.productName), quantity: asNumber(data.quantity), supplierResponseUnitPrice: typeof data.supplierResponseUnitPrice === 'number' && Number.isInteger(data.supplierResponseUnitPrice) && data.supplierResponseUnitPrice >= 0 ? data.supplierResponseUnitPrice : null, unit: asText(data.unit), supplierQuoteRequestEnabled: data.supplierQuoteRequestEnabled !== false, marketplaceOfferEnabled: data.marketplaceOfferEnabled !== false, ecPurchaseCandidates: readEcPurchaseCandidates(data.ecPurchaseCandidates), requestedDeliveryDate: asTimestamp(data.requestedDeliveryDate), status: asText(data.status) as RfqItemStatus, note: asText(data.note), createdAt: asTimestamp(data.createdAt), updatedAt: asTimestamp(data.updatedAt), archivedAt: asTimestamp(data.archivedAt) }
}
function itemCollection(rfqId: string) { return collection(firestore, 'rfqs', rfqId, 'items') }
function toDocument(input: RfqItemInput) {
  const parsed = rfqItemSchema.parse(input)
  return { ...parsed, requestedDeliveryDate: parsed.requestedDeliveryDate ? Timestamp.fromDate(new Date(`${parsed.requestedDeliveryDate}T00:00:00`)) : null }
}
export function subscribeRfqItems(rfqId: string, onChange: (items: RfqItem[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(itemCollection(rfqId), orderBy('lineNo')), snapshot => onChange(snapshot.docs.map(item => readItem(item.id, item.data()))), onError)
}
export function subscribeRfqItemProducts(onChange: (products: RfqItemProduct[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(firestore, 'products'), orderBy('manufacturerName')), snapshot => onChange(snapshot.docs.map(item => ({ id: item.id, manufacturerId: asText(item.data().manufacturerId), manufacturerName: asText(item.data().manufacturerName), partNumber: asText(item.data().partNumber), name: asText(item.data().name), unit: asText(item.data().unit), active: item.data().active !== false }))), onError)
}
export async function createRfqItem(rfqId: string, input: RfqItemInput): Promise<void> {
  const payload = toDocument(input)
  const itemRef = doc(itemCollection(rfqId))
  const counterRef = doc(firestore, 'rfqs', rfqId, 'itemCounters', 'sequence')
  await runTransaction(firestore, async transaction => {
    const parent = await transaction.get(doc(firestore, 'rfqs', rfqId))
    const counter = await transaction.get(counterRef)
    if (!parent.exists()) throw new Error('RFQ案件が見つかりません。')
    const lineNo = counter.exists() ? asNumber(counter.data().lastLineNo) + 1 : 1
    if (!Number.isSafeInteger(lineNo) || lineNo < 1) throw new Error('品目番号が不正です。')
    transaction.set(counterRef, { lastLineNo: lineNo, updatedAt: serverTimestamp() })
    transaction.set(itemRef, { ...payload, lineNo, archivedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  })
}
export async function updateRfqItem(rfqId: string, itemId: string, input: RfqItemInput): Promise<void> {
  const payload = toDocument(input)
  const itemRef = doc(firestore, 'rfqs', rfqId, 'items', itemId)
  await runTransaction(firestore, async transaction => {
    const current = await transaction.get(itemRef)
    if (!current.exists() || current.data().archivedAt != null) throw new Error('品目が削除されています。再読込してください。')
    transaction.update(itemRef, { ...payload, updatedAt: serverTimestamp() })
  })
}
export async function setRfqItemSupplierResponseUnitPrices(rfqId: string, updates: { itemId: string; supplierResponseUnitPrice: number }[]): Promise<void> {
  if (updates.length === 0 || updates.length > 500) throw new Error('反映する品目を1〜500件選択してください。')
  if (new Set(updates.map(update => update.itemId)).size !== updates.length) throw new Error('同じ品目を重複して反映できません。')
  if (updates.some(update => !update.itemId || !Number.isSafeInteger(update.supplierResponseUnitPrice) || update.supplierResponseUnitPrice < 0 || update.supplierResponseUnitPrice > 1_000_000_000)) throw new Error('仕入先回答単価が不正です。')
  const batch = writeBatch(firestore)
  for (const update of updates) batch.update(doc(firestore, 'rfqs', rfqId, 'items', update.itemId), { supplierResponseUnitPrice: update.supplierResponseUnitPrice, updatedAt: serverTimestamp() })
  await batch.commit()
}
export async function appendRfqItemEcPurchaseCandidates(rfqId: string, itemId: string, candidates: EcPurchaseCandidate[]): Promise<number> {
  const parsed = ecPurchaseCandidateSchema.array().max(10).parse(candidates)
  const itemRef = doc(firestore, 'rfqs', rfqId, 'items', itemId)
  return runTransaction(firestore, async transaction => {
    const current = await transaction.get(itemRef)
    if (!current.exists() || current.data().archivedAt != null || current.data().status === 'cancelled') throw new Error('品目が変更または削除されています。再読込してください。')
    const existing = readEcPurchaseCandidates(current.data().ecPurchaseCandidates)
    const additions = parsed.filter(candidate => !existing.some(value => value.url === candidate.url)).slice(0, 10 - existing.length)
    if (additions.length > 0) transaction.update(itemRef, { ecPurchaseCandidates: [...existing, ...additions].sort((a, b) => a.price - b.price), updatedAt: serverTimestamp() })
    return additions.length
  })
}export async function setRfqItemSourcingTargets(rfqId: string, itemId: string, supplierQuoteRequestEnabled: boolean, marketplaceOfferEnabled: boolean): Promise<void> {
  if (!supplierQuoteRequestEnabled && !marketplaceOfferEnabled) throw new Error('対応先を1つ以上選択してください。')
  const itemRef = doc(firestore, 'rfqs', rfqId, 'items', itemId)
  await runTransaction(firestore, async transaction => {
    const current = await transaction.get(itemRef)
    if (!current.exists() || current.data().archivedAt != null) throw new Error('品目が削除されています。再読込してください。')
    transaction.update(itemRef, { supplierQuoteRequestEnabled, marketplaceOfferEnabled, updatedAt: serverTimestamp() })
  })
}
export async function saveRfqItemTranslation(rfqId: string, itemId: string, originalDescription: string, translatedDescription: string, previousTranslation: string): Promise<void> {
  const source = originalDescription.trim()
  const translated = translatedDescription.trim()
  if (!source || source.length > 5000 || !translated || translated.length > 5000) throw new Error('翻訳する原文または訳文が不正です。')
  const itemRef = doc(firestore, 'rfqs', rfqId, 'items', itemId)
  await runTransaction(firestore, async transaction => {
    const current = await transaction.get(itemRef)
    if (!current.exists() || current.data().archivedAt != null) throw new Error('品目が削除されています。再読込してください。')
    if (current.data().status === 'cancelled') throw new Error('品目が取消済みです。')
    if (asText(current.data().originalDescription) !== originalDescription || asText(current.data().translatedDescription) !== previousTranslation) throw new Error('原文または訳文が変更されています。再読込してから翻訳し直してください。')
    transaction.update(itemRef, { translatedDescription: translated, updatedAt: serverTimestamp() })
  })
}
export async function setRfqItemArchived(rfqId: string, itemId: string, archived: boolean): Promise<void> {
  const itemRef = doc(firestore, 'rfqs', rfqId, 'items', itemId)
  await runTransaction(firestore, async transaction => {
    const current = await transaction.get(itemRef)
    if (!current.exists()) throw new Error('品目が見つかりません。')
    transaction.update(itemRef, { archivedAt: archived ? serverTimestamp() : null, updatedAt: serverTimestamp() })
  })
}
