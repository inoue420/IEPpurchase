import { Timestamp, addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
import { firebaseAuth, firestore } from '../../firebase/firebase'
import { supplierQuoteRequestSchema, type SupplierQuoteRequestStatus } from './supplierQuoteRequestSchema'

export interface SupplierQuoteRequestInput { supplierId: string; supplierName: string; rfqItemIds: string[]; requestedAt: string; responseDueDate: string; status: SupplierQuoteRequestStatus; note: string }
export interface SupplierQuoteRequestDocument extends Omit<SupplierQuoteRequestInput, 'requestedAt' | 'responseDueDate'> { rfqId: string; requestedAt: Timestamp | null; responseDueDate: Timestamp | null; createdAt: Timestamp | null; createdBy: string; updatedAt: Timestamp | null; updatedBy: string }
export interface SupplierQuoteRequest extends SupplierQuoteRequestDocument { id: string }
const text = (value: unknown) => typeof value === 'string' ? value : ''
const timestamp = (value: unknown) => value instanceof Timestamp ? value : null
const toDate = (value: string) => value ? Timestamp.fromDate(new Date(`${value}T00:00:00`)) : null
function read(id: string, data: Record<string, unknown>): SupplierQuoteRequest {
  return { id, rfqId: text(data.rfqId), supplierId: text(data.supplierId), supplierName: text(data.supplierName), rfqItemIds: Array.isArray(data.rfqItemIds) ? data.rfqItemIds.filter((value): value is string => typeof value === 'string') : [], requestedAt: timestamp(data.requestedAt), responseDueDate: timestamp(data.responseDueDate), status: text(data.status) as SupplierQuoteRequestStatus, note: text(data.note), createdAt: timestamp(data.createdAt), createdBy: text(data.createdBy), updatedAt: timestamp(data.updatedAt), updatedBy: text(data.updatedBy) }
}
function payload(input: SupplierQuoteRequestInput) { const value = supplierQuoteRequestSchema.parse(input); return { ...value, requestedAt: toDate(value.requestedAt), responseDueDate: toDate(value.responseDueDate) } }
export function subscribeSupplierQuoteRequests(rfqId: string, change: (requests: SupplierQuoteRequest[]) => void, failed: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(firestore, 'supplierQuoteRequests'), where('rfqId', '==', rfqId), orderBy('createdAt', 'desc')), snapshot => change(snapshot.docs.map(item => read(item.id, item.data()))), failed)
}
function currentUserId() { const uid = firebaseAuth.currentUser?.uid; if (!uid) throw new Error('ログイン状態を確認できません。'); return uid }
async function validateRfqItems(rfqId: string, rfqItemIds: string[]) {
  const items = await Promise.all(rfqItemIds.map(id => getDoc(doc(firestore, 'rfqs', rfqId, 'items', id))))
  if (items.some(item => !item.exists() || item.data().archivedAt != null)) {
    throw new Error('対象品目が見つからないか、無効になっています。再読込してください。')
  }
}
export async function createSupplierQuoteRequest(rfqId: string, input: SupplierQuoteRequestInput) { const uid = currentUserId(); const value = payload(input); await validateRfqItems(rfqId, value.rfqItemIds); await addDoc(collection(firestore, 'supplierQuoteRequests'), { ...value, rfqId, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid }) }
export async function updateSupplierQuoteRequest(rfqId: string, id: string, input: SupplierQuoteRequestInput) { const uid = currentUserId(); const value = payload(input); await validateRfqItems(rfqId, value.rfqItemIds); await updateDoc(doc(firestore, 'supplierQuoteRequests', id), { ...value, updatedAt: serverTimestamp(), updatedBy: uid }) }
