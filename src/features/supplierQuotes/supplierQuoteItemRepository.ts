import { Timestamp, collection, doc, onSnapshot, runTransaction, serverTimestamp, type Unsubscribe, type WithFieldValue } from 'firebase/firestore'
import { z } from 'zod'
import { firebaseAuth, firestore } from '../../firebase/firebase'
import { calculateLine, MAX_QUOTE_AMOUNT, type Amounts } from './quoteMoney'
import { supplierQuoteItemSchema, type SupplierQuoteItemInput } from './supplierQuoteItemSchema'

export interface SupplierQuoteItemDocument extends Omit<SupplierQuoteItemInput, 'deliveryDate'>, Amounts {
  rfqId: string; quantityMillis: number; shippingTotal: number; deliveryDate: Timestamp | null
  revision: number; createdAt: Timestamp | null; createdBy: string; updatedAt: Timestamp | null; updatedBy: string
}
export interface SupplierQuoteItem extends SupplierQuoteItemDocument { id: string }
const metadataSchema = z.object({
  rfqId: z.string().min(1), revision: z.number().int().positive(),
  createdAt: z.instanceof(Timestamp).nullable(), updatedAt: z.instanceof(Timestamp).nullable(),
  createdBy: z.string(), updatedBy: z.string(), deliveryDate: z.instanceof(Timestamp).nullable(),
})

export function subscribeSupplierQuoteItems(quoteId: string, changed: (items: SupplierQuoteItem[]) => void, failed: (error: Error) => void): Unsubscribe {
  return onSnapshot(collection(firestore, 'supplierQuotes', quoteId, 'items'), snapshot => {
    try {
      const items: SupplierQuoteItem[] = snapshot.docs.map(item => {
        const data = item.data()
        const metadata = metadataSchema.parse(data)
        const parsed = supplierQuoteItemSchema.parse({ ...data, deliveryDate: metadata.deliveryDate?.toDate().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) ?? '' })
        const amounts = calculateLine(parsed)
        if (Object.entries(amounts).some(([key, value]) => data[key] !== value)) throw new Error('明細の保存金額が計算結果と一致しません。')
        return { ...parsed, ...metadata, ...amounts, id: item.id }
      })
      changed(items.sort((a, b) => a.rfqItemId.localeCompare(b.rfqItemId) || a.id.localeCompare(b.id)))
    } catch (cause) { failed(cause instanceof Error ? cause : new Error('明細データを読み取れませんでした。')) }
  }, failed)
}

export async function saveSupplierQuoteItem(rfqId: string, quoteId: string, itemId: string | null, expectedRevision: number, input: SupplierQuoteItemInput): Promise<void> {
  const uid = firebaseAuth.currentUser?.uid
  if (!uid) throw new Error('ログイン状態を確認してください。')
  const parsed = supplierQuoteItemSchema.parse(input)
  const amounts = calculateLine(parsed)
  const quoteRef = doc(firestore, 'supplierQuotes', quoteId)
  const itemRef = itemId ? doc(quoteRef, 'items', itemId) : doc(collection(quoteRef, 'items'))
  await runTransaction(firestore, async transaction => {
    const quote = await transaction.get(quoteRef)
    const previous = await transaction.get(itemRef)
    const rfqItem = await transaction.get(doc(firestore, 'rfqs', rfqId, 'items', parsed.rfqItemId))
    if (!quote.exists() || quote.data().rfqId !== rfqId || quote.data().archivedAt != null || quote.data().status === 'withdrawn') throw new Error('この見積は編集できません。')
    const header = quote.data()
    if (header.revision !== expectedRevision) throw new Error('別の操作で見積が更新されました。閉じて最新の内容から再編集してください。')
    if (Boolean(itemId) !== previous.exists()) throw new Error('明細の状態が変わりました。再読込してください。')
    if (!rfqItem.exists() || rfqItem.data().archivedAt != null || rfqItem.data().status === 'cancelled' || (rfqItem.data().productId || null) !== parsed.productId) throw new Error('案件品目または商品紐付けが変更・無効化されています。再選択してください。')
    if (previous.exists() && previous.data().rfqItemId !== parsed.rfqItemId) throw new Error('登録済み明細の案件品目は変更できません。')
    if (header.requestId) {
      const request = await transaction.get(doc(firestore, 'supplierQuoteRequests', header.requestId))
      if (!request.exists() || request.data().rfqId !== rfqId || request.data().supplierId !== header.supplierId || request.data().status === 'cancelled' || !request.data().rfqItemIds.includes(parsed.rfqItemId)) throw new Error('選択品目が関連する見積依頼の対象ではありません。')
    }
    const managed = header.itemCount !== undefined
    const old = previous.data()
    const totals = {
      subtotal: (managed ? header.subtotal : 0) - (old?.subtotal ?? 0) + amounts.subtotal,
      tax: (managed ? header.tax : 0) - (old?.tax ?? 0) + amounts.tax,
      total: (managed ? header.total : 0) - (old?.total ?? 0) + amounts.total,
      shippingTotal: (header.shippingTotal ?? 0) - (old?.shippingTotal ?? 0) + amounts.shippingTotal,
    }
    if (Object.values(totals).some(value => !Number.isSafeInteger(value) || value < 0 || value > MAX_QUOTE_AMOUNT)) throw new Error('見積合計が上限を超えています。')
    const revision = header.revision + 1
    const itemRevision = (old?.revision ?? 0) + 1
    const itemRecord: WithFieldValue<SupplierQuoteItemDocument> = {
      ...parsed, ...amounts, rfqId, deliveryDate: parsed.deliveryDate ? Timestamp.fromDate(new Date(`${parsed.deliveryDate}T00:00:00+09:00`)) : null,
      revision: itemRevision,
      createdAt: old?.createdAt ?? serverTimestamp(), createdBy: old?.createdBy ?? uid,
      updatedAt: serverTimestamp(), updatedBy: uid,
    }
    const nextHeader = { ...header, ...totals, itemCount: (header.itemCount ?? 0) + (old ? 0 : 1), lastItemId: itemRef.id, revision, updatedAt: serverTimestamp(), updatedBy: uid }
    // One changed item per transaction lets Rules verify the aggregate delta without a collection scan.
    transaction.set(itemRef, itemRecord)
    transaction.set(doc(itemRef, 'revisions', String(itemRevision)), { snapshot: itemRecord, createdAt: serverTimestamp(), createdBy: uid })
    transaction.set(quoteRef, nextHeader)
    transaction.set(doc(quoteRef, 'revisions', String(revision)), { revision, snapshot: nextHeader, previousSnapshot: header, createdAt: serverTimestamp(), createdBy: uid })
  })
}
