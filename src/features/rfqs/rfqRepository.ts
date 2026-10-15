import { Timestamp, collection, doc, getDoc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, type Unsubscribe } from 'firebase/firestore'
import { firebaseAuth, firestore } from '../../firebase/firebase'
import { rfqSchema, type RfqStatus } from './rfqSchema'
import { prepareDeliveryLocation, selectDeliveryLocation } from '../deliveryLocations/deliveryLocationRepository'
import type { DeliveryLocationSelection } from '../../../functions/src/deliveryLocationModel'
export interface RfqInput { customerId: string; subject: string; receivedAt: string; dueDate: string; requestedDeliveryDate: string; status: RfqStatus; assignedUserId: string; note: string; deliveryLocationName?: string; deliveryLocationId?: string }
export interface RfqDocument extends Omit<RfqInput, 'receivedAt' | 'dueDate' | 'requestedDeliveryDate'> { rfqNumber: string; customerName: string; receivedAt: Timestamp | null; dueDate: Timestamp | null; requestedDeliveryDate: Timestamp | null; createdAt: Timestamp | null; createdBy: string; updatedAt: Timestamp | null; updatedBy: string }
export interface Rfq extends RfqDocument { id: string }
export interface RfqCustomer { id: string; name: string; active: boolean }
const rfqsCollection = collection(firestore, 'rfqs'); const asText = (value: unknown): string => typeof value === 'string' ? value : ''; const asTimestamp = (value: unknown): Timestamp | null => value instanceof Timestamp ? value : null; const toTimestamp = (value: string): Timestamp | null => value ? Timestamp.fromDate(new Date(`${value}T00:00:00`)) : null
function readRfq(id: string, data: Record<string, unknown>): Rfq { return { id, rfqNumber: asText(data.rfqNumber), customerId: asText(data.customerId), customerName: asText(data.customerName), subject: asText(data.subject), receivedAt: asTimestamp(data.receivedAt), dueDate: asTimestamp(data.dueDate), requestedDeliveryDate: asTimestamp(data.requestedDeliveryDate), status: asText(data.status) as RfqStatus, assignedUserId: asText(data.assignedUserId), note: asText(data.note), deliveryLocationId: asText(data.deliveryLocationId), deliveryLocationName: asText(data.deliveryLocationName), createdAt: asTimestamp(data.createdAt), createdBy: asText(data.createdBy), updatedAt: asTimestamp(data.updatedAt), updatedBy: asText(data.updatedBy) } }
export function subscribeRfqs(onChange: (rfqs: Rfq[]) => void, onError: (error: Error) => void): Unsubscribe { return onSnapshot(query(rfqsCollection, orderBy('receivedAt', 'desc')), snapshot => onChange(snapshot.docs.map(item => readRfq(item.id, item.data()))), onError) }
export async function getRfq(id: string): Promise<Rfq | null> { const snapshot = await getDoc(doc(firestore, 'rfqs', id)); return snapshot.exists() ? readRfq(snapshot.id, snapshot.data()) : null }
export function subscribeRfq(id: string, change: (rfq: Rfq | null) => void, fail: (error: Error) => void) {
  return onSnapshot(doc(firestore, 'rfqs', id), snapshot => change(snapshot.exists() ? readRfq(snapshot.id, snapshot.data()) : null), fail)
}
export function subscribeRfqCustomers(onChange: (customers: RfqCustomer[]) => void, onError: (error: Error) => void): Unsubscribe { return onSnapshot(query(collection(firestore, 'customers'), orderBy('name')), snapshot => onChange(snapshot.docs.map(item => ({ id: item.id, name: asText(item.data().name), active: item.data().active !== false }))), onError) }
function toDocument(input: RfqInput, customerName: string) { const parsed = rfqSchema.parse(input); return { ...parsed, customerName, receivedAt: toTimestamp(parsed.receivedAt), dueDate: toTimestamp(parsed.dueDate), requestedDeliveryDate: toTimestamp(parsed.requestedDeliveryDate) } }
export async function createRfq(input: RfqInput, customerName: string): Promise<string> {
  const userId = firebaseAuth.currentUser?.uid
  if (!userId) throw new Error('認証情報がありません。')
  const payload = toDocument(input, customerName), prepared = await prepareDeliveryLocation(payload.deliveryLocationName)
  const year = input.receivedAt.slice(0, 4), rfqRef = doc(rfqsCollection), counterRef = doc(firestore, 'rfqCounters', year)
  await runTransaction(firestore, async transaction => {
    const counter = await transaction.get(counterRef)
    const selection = await selectDeliveryLocation(transaction, prepared)
    const nextSequence = counter.exists() && typeof counter.data().nextSequence === 'number' ? counter.data().nextSequence + 1 : 1
    transaction.set(counterRef, { year, nextSequence, updatedAt: serverTimestamp() })
    transaction.set(rfqRef, { ...payload, ...selection, rfqNumber: `RFQ-${year}-${String(nextSequence).padStart(6, '0')}`, createdAt: serverTimestamp(), createdBy: userId, updatedAt: serverTimestamp(), updatedBy: userId })
  })
  return rfqRef.id
}
export async function updateRfq(id: string, input: RfqInput, customerName: string): Promise<void> {
  const userId = firebaseAuth.currentUser?.uid
  if (!userId) throw new Error('認証情報がありません。')
  const payload = toDocument(input, customerName), prepared = await prepareDeliveryLocation(payload.deliveryLocationName), ref = doc(firestore, 'rfqs', id)
  await runTransaction(firestore, async transaction => {
    const current = await transaction.get(ref)
    // Old callers omit the field; preserve their existing RFQ selection.
    const unchanged = input.deliveryLocationName === undefined || (payload.deliveryLocationName === (current.get('deliveryLocationName') ?? ''))
    const selection = unchanged ? { deliveryLocationId: current.get('deliveryLocationId') ?? '', deliveryLocationName: current.get('deliveryLocationName') ?? '' } : await selectDeliveryLocation(transaction, prepared)
    transaction.update(ref, { ...payload, ...selection, updatedAt: serverTimestamp(), updatedBy: userId })
  })
}
export async function updateRfqDeliveryLocation(id: string, name: string, expected: DeliveryLocationSelection): Promise<void> {
  const userId = firebaseAuth.currentUser?.uid
  if (!userId) throw new Error('ログインが必要です。')
  const prepared = await prepareDeliveryLocation(name), ref = doc(firestore, 'rfqs', id)
  await runTransaction(firestore, async transaction => {
    const current = await transaction.get(ref)
    if (!current.exists()) throw new Error('RFQ案件が見つかりません。')
    if ((current.get('deliveryLocationId') ?? '') !== expected.deliveryLocationId || (current.get('deliveryLocationName') ?? '') !== expected.deliveryLocationName) throw new Error('納品場所が変更されています。再読み込みして確認してください。')
    const selection = await selectDeliveryLocation(transaction, prepared)
    transaction.update(ref, { ...selection, updatedAt: serverTimestamp(), updatedBy: userId })
  })
}
