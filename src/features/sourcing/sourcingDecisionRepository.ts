import { Timestamp, collection, doc, onSnapshot, runTransaction, serverTimestamp, type Unsubscribe } from 'firebase/firestore'
import { firebaseAuth, firestore } from '../../firebase/firebase'
import { calculateLine, quantityMillis, type TaxCategory } from '../supplierQuotes/quoteMoney'
import type { SourcingCandidate } from './sourcingComparison'

export interface SourcingDecision {
  id: string; source: string; selectedQuantity: number; totalCost: number; shippingCost: number; reason: string
  status: 'active' | 'cancelled'; selectedAt: Timestamp | null
}
export interface SourcingState { selectedQuantityMillis: number }
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
const text = (value: unknown) => typeof value === 'string' ? value : ''

export function subscribeSourcingDecisions(rfqId: string, itemId: string, changed: (value: SourcingDecision[]) => void, failed: (error: Error) => void): Unsubscribe {
  return onSnapshot(collection(firestore, 'rfqs', rfqId, 'items', itemId, 'sourcingDecisions'), snapshot => changed(snapshot.docs.map(row => ({ id: row.id, source: text(row.data().source), selectedQuantity: number(row.data().selectedQuantity), totalCost: number(row.data().totalCost), shippingCost: number(row.data().shippingCost), reason: text(row.data().reason), status: text(row.data().status) as SourcingDecision['status'], selectedAt: row.data().selectedAt instanceof Timestamp ? row.data().selectedAt : null }))), failed)
}
export function subscribeSourcingState(rfqId: string, itemId: string, changed: (value: SourcingState) => void, failed: (error: Error) => void): Unsubscribe {
  return onSnapshot(doc(firestore, 'rfqs', rfqId, 'sourcingStates', itemId), row => changed({ selectedQuantityMillis: row.exists() ? number(row.data().selectedQuantityMillis) : 0 }), failed)
}
export async function selectSourcingCandidate(rfqId: string, itemId: string, candidate: SourcingCandidate, selectedQuantity: number, shippingCost: number, reason: string): Promise<void> {
  const uid = firebaseAuth.currentUser?.uid
  if (!uid) throw new Error('ログイン状態を確認してください。')
  const selectedMillis = quantityMillis(selectedQuantity)
  if (selectedMillis > quantityMillis(candidate.quantity)) throw new Error('採用数量は候補の提示数量以下にしてください。')
  if (candidate.shippingFee === null || candidate.total === null) throw new Error('送料・総額が未確認の候補は採用できません。')
  if (!Number.isSafeInteger(shippingCost) || shippingCost < 0) throw new Error('送料は0以上の整数円で入力してください。')
  if (candidate.expired && !reason.trim()) throw new Error('期限切れ候補を採用する理由を入力してください。')
  const money = calculateLine({ quantity: selectedQuantity, unitPrice: candidate.unitPrice, shippingFee: shippingCost, taxCategory: candidate.taxCategory, taxRateBps: candidate.taxRateBps, shippingTaxCategory: candidate.shippingTaxCategory, shippingTaxRateBps: candidate.shippingTaxRateBps })
  const itemRef = doc(firestore, 'rfqs', rfqId, 'items', itemId), stateRef = doc(firestore, 'rfqs', rfqId, 'sourcingStates', itemId), decisionRef = doc(collection(firestore, 'rfqs', rfqId, 'items', itemId, 'sourcingDecisions'))
  await runTransaction(firestore, async tx => {
    const [item, state] = await Promise.all([tx.get(itemRef), tx.get(stateRef)])
    if (!item.exists() || item.data().archivedAt != null || item.data().status === 'cancelled' || item.data().unit !== candidate.unit) throw new Error('案件品目が変更されています。再読込してください。')
    const used = state.exists() ? number(state.data().selectedQuantityMillis) : 0
    if (used + selectedMillis > quantityMillis(number(item.data().quantity))) throw new Error('採用数量の合計が必要数量を超えます。')
    tx.set(decisionRef, { rfqId, rfqItemId: itemId, source: candidate.source, sourceType: candidate.sourceType, sourceRecordId: candidate.id, sourceQuoteId: candidate.sourceQuoteId, supplierId: candidate.supplierId, supplierName: candidate.seller, selectedQuantity, selectedQuantityMillis: selectedMillis, unitCost: candidate.unitPrice, shippingCost, subtotal: money.subtotal, tax: money.tax, totalCost: money.total, taxCategory: candidate.taxCategory as TaxCategory, taxRateBps: candidate.taxRateBps, shippingTaxCategory: candidate.shippingTaxCategory as TaxCategory, shippingTaxRateBps: candidate.shippingTaxRateBps, itemName: candidate.itemName, partNumber: candidate.partNumber, unit: candidate.unit, reason: reason.trim(), status: 'active', selectedBy: uid, selectedAt: serverTimestamp(), cancelledAt: null })
    tx.set(stateRef, { rfqItemId: itemId, selectedQuantityMillis: used + selectedMillis, updatedAt: serverTimestamp() })
  })
}
export async function cancelSourcingDecision(rfqId: string, itemId: string, decision: SourcingDecision): Promise<void> {
  const decisionRef = doc(firestore, 'rfqs', rfqId, 'items', itemId, 'sourcingDecisions', decision.id), stateRef = doc(firestore, 'rfqs', rfqId, 'sourcingStates', itemId)
  await runTransaction(firestore, async tx => { const [current, state] = await Promise.all([tx.get(decisionRef), tx.get(stateRef)]); if (!current.exists() || !state.exists() || current.data().status !== 'active') throw new Error('採用状態が変更されています。'); const next = number(state.data().selectedQuantityMillis) - number(current.data().selectedQuantityMillis); if (next < 0) throw new Error('採用数量の集計が不正です。'); tx.update(decisionRef, { status: 'cancelled', cancelledAt: serverTimestamp() }); tx.update(stateRef, { selectedQuantityMillis: next, updatedAt: serverTimestamp() }) })
}
