import { Timestamp, collection, doc, getDoc, onSnapshot, query, runTransaction, serverTimestamp, where, type Unsubscribe } from 'firebase/firestore'
import { firebaseAuth, firestore } from '../../firebase/firebase'
import { supplierQuoteSchema, type SupplierQuoteStatus } from './supplierQuoteSchema'

export interface SupplierQuoteInput { supplierId: string; supplierName: string; requestId: string; quoteNumber: string; quoteDate: string; validUntil: string; documentId: string; subtotal: number; tax: number; total: number; status: SupplierQuoteStatus; note: string }
export interface SupplierQuoteDocument extends Omit<SupplierQuoteInput, 'requestId' | 'quoteDate' | 'validUntil' | 'documentId'> { rfqId: string; requestId: string | null; quoteDate: Timestamp | null; validUntil: Timestamp | null; documentId: string | null; revision: number; archivedAt: Timestamp | null; archivedBy: string | null; createdAt: Timestamp | null; createdBy: string; updatedAt: Timestamp | null; updatedBy: string }
export interface SupplierQuote extends SupplierQuoteDocument { id: string; itemCount?: number; shippingTotal?: number }
const text = (value: unknown) => typeof value === 'string' ? value : ''
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
const timestamp = (value: unknown) => value instanceof Timestamp ? value : null
const date = (value: string) => value ? Timestamp.fromDate(new Date(`${value}T00:00:00`)) : null
const currentUserId = () => { const uid = firebaseAuth.currentUser?.uid; if (!uid) throw new Error('ログイン状態を確認できません。'); return uid }
function read(id: string, data: Record<string, unknown>): SupplierQuote { return { id, rfqId: text(data.rfqId), supplierId: text(data.supplierId), supplierName: text(data.supplierName), requestId: text(data.requestId) || null, quoteNumber: text(data.quoteNumber), quoteDate: timestamp(data.quoteDate), validUntil: timestamp(data.validUntil), documentId: text(data.documentId) || null, subtotal: number(data.subtotal), tax: number(data.tax), total: number(data.total), status: text(data.status) as SupplierQuoteStatus, note: text(data.note), revision: number(data.revision), archivedAt: timestamp(data.archivedAt), archivedBy: text(data.archivedBy) || null, createdAt: timestamp(data.createdAt), createdBy: text(data.createdBy), updatedAt: timestamp(data.updatedAt), updatedBy: text(data.updatedBy) } }
function payload(input: SupplierQuoteInput) { const value = supplierQuoteSchema.parse(input); return { ...value, requestId: value.requestId || null, quoteDate: date(value.quoteDate), validUntil: date(value.validUntil), documentId: value.documentId || null } }
async function validateReferences(rfqId: string, value: ReturnType<typeof payload>) { const supplier = await getDoc(doc(firestore, 'suppliers', value.supplierId)); if (!supplier.exists() || supplier.data().active === false || text(supplier.data().name) !== value.supplierName) throw new Error('仕入先が見つからないか、無効になっています。再読込してください。'); if (!value.requestId) return; const request = await getDoc(doc(firestore, 'supplierQuoteRequests', value.requestId)); if (!request.exists() || text(request.data().rfqId) !== rfqId || text(request.data().supplierId) !== value.supplierId) throw new Error('選択した見積依頼が案件または仕入先と一致しません。') }
export function subscribeSupplierQuotes(rfqId: string, change: (quotes: SupplierQuote[]) => void, failed: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(firestore, 'supplierQuotes'), where('rfqId', '==', rfqId)), snapshot => {
    const quotes = snapshot.docs.map(item => ({ ...read(item.id, item.data()), itemCount: typeof item.data().itemCount === 'number' ? item.data().itemCount as number : undefined, shippingTotal: typeof item.data().shippingTotal === 'number' ? item.data().shippingTotal as number : undefined }))
    quotes.sort((left, right) => (right.updatedAt?.toMillis() ?? 0) - (left.updatedAt?.toMillis() ?? 0))
    change(quotes)
  }, failed)
}
export async function createSupplierQuote(rfqId: string, input: SupplierQuoteInput) { const uid = currentUserId(); const value = payload(input); await validateReferences(rfqId, value); const quote = doc(collection(firestore, 'supplierQuotes')); const record = { ...value, rfqId, revision: 1, archivedAt: null, archivedBy: null, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid }; await runTransaction(firestore, async transaction => { transaction.set(quote, record); transaction.set(doc(quote, 'revisions', '1'), { revision: 1, snapshot: { ...value, rfqId }, createdAt: serverTimestamp(), createdBy: uid }) }) }
export async function updateSupplierQuote(rfqId: string, id: string, input: SupplierQuoteInput, expectedRevision: number) {
  const uid = currentUserId(); const value = payload(input)
  await validateReferences(rfqId, value)
  const quote = doc(firestore, 'supplierQuotes', id)
  await runTransaction(firestore, async transaction => {
    const current = await transaction.get(quote)
    if (!current.exists() || current.data().rfqId !== rfqId || current.data().archivedAt != null) throw new Error('見積が見つからないか、無効です。再読込してください。')
    const old = current.data()
    if (old.revision !== expectedRevision) throw new Error('別の操作で更新されました。閉じて最新の内容から再編集してください。')
    if (old.itemCount !== undefined && (value.supplierId !== old.supplierId || value.requestId !== old.requestId || value.subtotal !== old.subtotal || value.tax !== old.tax || value.total !== old.total)) throw new Error('明細登録後は仕入先・見積依頼・合計を直接変更できません。')
    const revision = number(old.revision) + 1
    if (!Number.isSafeInteger(revision) || revision < 2) throw new Error('見積の版数が不正です。')
    const next = { ...old, ...value, revision, updatedAt: serverTimestamp(), updatedBy: uid }
    transaction.set(quote, next)
    transaction.set(doc(quote, 'revisions', String(revision)), { revision, snapshot: next, previousSnapshot: old, createdAt: serverTimestamp(), createdBy: uid })
  })
}
