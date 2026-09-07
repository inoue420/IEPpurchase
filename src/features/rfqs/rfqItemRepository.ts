import { Timestamp, collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, type Unsubscribe } from 'firebase/firestore'
import { firestore } from '../../firebase/firebase'
import { rfqItemSchema, type RfqItemStatus } from './rfqItemSchema'

export interface RfqItemInput { originalDescription: string; translatedDescription: string; productId: string; manufacturerId: string; manufacturerName: string; partNumber: string; productName: string; quantity: number; unit: string; requestedDeliveryDate: string; status: RfqItemStatus; note: string }
export interface RfqItemDocument extends Omit<RfqItemInput, 'requestedDeliveryDate'> { lineNo: number; requestedDeliveryDate: Timestamp | null; createdAt: Timestamp | null; updatedAt: Timestamp | null; archivedAt: Timestamp | null }
export interface RfqItem extends RfqItemDocument { id: string }
export interface RfqItemProduct { id: string; manufacturerId: string; manufacturerName: string; partNumber: string; name: string; unit: string; active: boolean }
const asText = (value: unknown): string => typeof value === 'string' ? value : ''
const asNumber = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
const asTimestamp = (value: unknown): Timestamp | null => value instanceof Timestamp ? value : null
function readItem(id: string, data: Record<string, unknown>): RfqItem {
  return { id, lineNo: asNumber(data.lineNo), originalDescription: asText(data.originalDescription), translatedDescription: asText(data.translatedDescription), productId: asText(data.productId), manufacturerId: asText(data.manufacturerId), manufacturerName: asText(data.manufacturerName), partNumber: asText(data.partNumber), productName: asText(data.productName), quantity: asNumber(data.quantity), unit: asText(data.unit), requestedDeliveryDate: asTimestamp(data.requestedDeliveryDate), status: asText(data.status) as RfqItemStatus, note: asText(data.note), createdAt: asTimestamp(data.createdAt), updatedAt: asTimestamp(data.updatedAt), archivedAt: asTimestamp(data.archivedAt) }
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
export async function setRfqItemArchived(rfqId: string, itemId: string, archived: boolean): Promise<void> {
  const itemRef = doc(firestore, 'rfqs', rfqId, 'items', itemId)
  await runTransaction(firestore, async transaction => {
    const current = await transaction.get(itemRef)
    if (!current.exists()) throw new Error('品目が見つかりません。')
    transaction.update(itemRef, { archivedAt: archived ? serverTimestamp() : null, updatedAt: serverTimestamp() })
  })
}
