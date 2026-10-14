import { Timestamp, collection, doc, getDoc, onSnapshot, runTransaction, serverTimestamp, writeBatch, type Unsubscribe } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, firebaseFunctions } from '../../firebase/firebase'
import type { RfqItem } from '../rfqs/rfqItemRepository'

export type SalesQuoteTranslationStatus = 'draft' | 'confirmed'
export interface SalesQuoteTranslationItem {
  id: string
  rfqId: string
  rfqItemId: string
  lineNo: number
  partNumber: string
  quantity: number
  unit: string
  originalDescription: string
  translatedDescription: string
  outputDescription: string
  confirmedAt: Timestamp | null
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}
export interface SalesQuoteTranslation { rfqId: string; status: SalesQuoteTranslationStatus; createdAt: Timestamp | null; updatedAt: Timestamp | null; confirmedAt: Timestamp | null }
export interface SalesQuoteExportState {
  revision: number; digest: string; status: 'draft' | 'failed' | 'sent' | 'sending' | 'uncertain'
  editing?: boolean; operation?: 'create' | 'update'; updateTarget?: { id: number; number: string } | null
  result?: { id: number; number: string } | null; previousResult?: { id: number; number: string } | null
}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
const timestamp = (value: unknown) => value instanceof Timestamp ? value : null
const quoteRef = (rfqId: string) => doc(firestore, 'salesQuotes', rfqId)
const itemRef = (rfqId: string, itemId: string) => doc(firestore, 'salesQuotes', rfqId, 'items', itemId)
const exportRef = (rfqId: string) => doc(firestore, 'salesQuotes', rfqId, 'freeeExports', 'current')

export function subscribeSalesQuoteExportState(rfqId: string, change: (value: SalesQuoteExportState | null) => void, fail: (error: Error) => void): Unsubscribe {
  return onSnapshot(exportRef(rfqId), snapshot => change(snapshot.exists() ? snapshot.data() as SalesQuoteExportState : null), fail)
}

export async function startSalesQuoteRevision(rfqId: string, saved: SalesQuoteExportState, customerPresented: boolean): Promise<void> {
  await httpsCallable(firebaseFunctions, 'startSalesQuoteRevision')({ rfqId, expectedRevision: saved.revision, digest: saved.digest, customerPresented })
}

function readItem(id: string, value: Record<string, unknown>): SalesQuoteTranslationItem {
  return { id, rfqId: text(value.rfqId), rfqItemId: text(value.rfqItemId), lineNo: number(value.lineNo), partNumber: text(value.partNumber), quantity: number(value.quantity), unit: text(value.unit), originalDescription: text(value.originalDescription), translatedDescription: text(value.translatedDescription), outputDescription: text(value.outputDescription), confirmedAt: timestamp(value.confirmedAt), createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt) }
}

export function subscribeSalesQuoteItems(rfqId: string, change: (items: SalesQuoteTranslationItem[]) => void, fail: (error: Error) => void): Unsubscribe {
  return onSnapshot(collection(firestore, 'salesQuotes', rfqId, 'items'), snapshot => change(snapshot.docs.map(value => readItem(value.id, value.data())).sort((a, b) => a.lineNo - b.lineNo)), fail)
}

export function subscribeSalesQuote(rfqId: string, change: (quote: SalesQuoteTranslation | null) => void, fail: (error: Error) => void): Unsubscribe {
  return onSnapshot(quoteRef(rfqId), snapshot => {
    if (!snapshot.exists()) { change(null); return }
    const data = snapshot.data()
    change({ rfqId: text(data.rfqId), status: text(data.status) === 'confirmed' ? 'confirmed' : 'draft', createdAt: timestamp(data.createdAt), updatedAt: timestamp(data.updatedAt), confirmedAt: timestamp(data.confirmedAt) })
  }, fail)
}

async function assertTranslationEditable(rfqId: string): Promise<void> {
  const saved = await getDoc(exportRef(rfqId))
  if (saved.exists() && !(saved.get('editing') === true && saved.get('status') === 'draft')) throw new Error('「改訂版を作成して編集」から編集を開始してください。保存済みの見積は履歴に保持します。')
}

export async function prepareSalesQuoteTranslation(rfqId: string, rfqItems: RfqItem[], quote: SalesQuoteTranslation | null, existingItems: SalesQuoteTranslationItem[]): Promise<void> {
  const active = rfqItems.filter(item => item.archivedAt === null && item.status !== 'cancelled')
  if (active.length === 0) throw new Error('取り込めるRFQ品目がありません。')
  if (quote) await assertTranslationEditable(rfqId)
  const batch = writeBatch(firestore)
  if (quote) batch.update(quoteRef(rfqId), { status: 'draft', confirmedAt: null, updatedAt: serverTimestamp() })
  else batch.set(quoteRef(rfqId), { rfqId, status: 'draft', confirmedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  const existingIds = new Set(existingItems.map(item => item.id))
  const activeIds = new Set(active.map(item => item.id))
  existingItems.filter(item => !activeIds.has(item.id)).forEach(item => batch.delete(itemRef(rfqId, item.id)))
  active.forEach(item => {
    const value = { rfqId, rfqItemId: item.id, lineNo: item.lineNo, partNumber: item.partNumber, quantity: item.quantity, unit: item.unit, originalDescription: item.originalDescription, translatedDescription: item.translatedDescription, outputDescription: item.translatedDescription, confirmedAt: null, updatedAt: serverTimestamp() }
    if (existingIds.has(item.id)) batch.update(itemRef(rfqId, item.id), value)
    else batch.set(itemRef(rfqId, item.id), { ...value, createdAt: serverTimestamp() })
  })
  await batch.commit()
}

export async function reopenSalesQuoteTranslation(rfqId: string, items: SalesQuoteTranslationItem[]): Promise<void> {
  await assertTranslationEditable(rfqId)
  const batch = writeBatch(firestore)
  batch.update(quoteRef(rfqId), { status: 'draft', confirmedAt: null, updatedAt: serverTimestamp() })
  items.forEach(item => batch.update(itemRef(rfqId, item.id), { confirmedAt: null, updatedAt: serverTimestamp() }))
  await batch.commit()
}

export async function updateSalesQuoteOutput(rfqId: string, itemId: string, outputDescription: string): Promise<void> {
  const output = outputDescription.trim()
  if (!output) throw new Error('見積用の出力文を入力してください。')
  if (output.length > 5000) throw new Error('見積用の出力文は5000文字以内で入力してください。')
  await runTransaction(firestore, async transaction => {
    const quote = await transaction.get(quoteRef(rfqId))
    if (!quote.exists() || quote.data().status !== 'draft') throw new Error('確定済み販売見積は編集できません。')
    transaction.update(itemRef(rfqId, itemId), { outputDescription: output, updatedAt: serverTimestamp() })
  })
}

export async function confirmSalesQuoteTranslation(rfqId: string, items: SalesQuoteTranslationItem[]): Promise<void> {
  if (items.some(item => !item.outputDescription.trim())) throw new Error('すべての品目に見積用の出力文を入力してください。')
  const batch = writeBatch(firestore)
  batch.update(quoteRef(rfqId), { status: 'confirmed', confirmedAt: serverTimestamp(), updatedAt: serverTimestamp() })
  items.forEach(item => batch.update(itemRef(rfqId, item.id), { confirmedAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  await batch.commit()
}
