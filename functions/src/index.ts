import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

initializeApp()
const db = getFirestore()
const MILLIS = 1000

function quantityMillis(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !/^\d+(\.\d{1,3})?$/.test(String(value))) throw new HttpsError('invalid-argument', '数量は0より大きく小数3桁以内で入力してください。')
  const [whole, fraction = ''] = String(value).split('.')
  return Number(whole) * MILLIS + Number(fraction.padEnd(3, '0'))
}

export const selectSourcingCandidate = onCall({ region: 'asia-northeast1' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。')
  const { rfqId, rfqItemId, candidate, selectedQuantity, shippingCost, reason } = request.data as Record<string, unknown>
  if (typeof rfqId !== 'string' || typeof rfqItemId !== 'string' || !candidate || typeof candidate !== 'object') throw new HttpsError('invalid-argument', '採用対象が不正です。')
  if (typeof shippingCost !== 'number' || !Number.isSafeInteger(shippingCost) || shippingCost < 0) throw new HttpsError('invalid-argument', '送料は0以上の整数円で入力してください。')
  const source = candidate as Record<string, unknown>
  const selectedMillis = quantityMillis(selectedQuantity)
  const offeredMillis = quantityMillis(source.quantity)
  if (selectedMillis > offeredMillis) throw new HttpsError('invalid-argument', '採用数量は候補提示数量以下にしてください。')
  if (source.unitCost === undefined || typeof source.unitCost !== 'number' || !Number.isSafeInteger(source.unitCost) || source.unitCost < 0) throw new HttpsError('invalid-argument', '候補単価が不正です。')
  if (source.expired === true && (typeof reason !== 'string' || !reason.trim())) throw new HttpsError('invalid-argument', '期限切れ候補の採用理由を入力してください。')
  const itemRef = db.doc(`rfqs/${rfqId}/items/${rfqItemId}`)
  const stateRef = db.doc(`rfqs/${rfqId}/sourcingStates/${rfqItemId}`)
  const decisionRef = itemRef.collection('sourcingDecisions').doc()
  await db.runTransaction(async transaction => {
    const [item, state] = await Promise.all([transaction.get(itemRef), transaction.get(stateRef)])
    if (!item.exists || item.get('archivedAt') || item.get('status') === 'cancelled' || item.get('unit') !== source.unit) throw new HttpsError('failed-precondition', '案件品目が変更されています。')
    const used = state.exists ? Number(state.get('selectedQuantityMillis') ?? 0) : 0
    if (!Number.isSafeInteger(used) || used + selectedMillis > quantityMillis(item.get('quantity'))) throw new HttpsError('failed-precondition', '採用数量の合計が必要数量を超えます。')
    const now = new Date()
    transaction.create(decisionRef, { rfqId, rfqItemId, sourceType: source.sourceType, sourceRecordId: source.id, sourceQuoteId: source.sourceQuoteId ?? null, supplierId: source.supplierId ?? null, supplierName: source.seller ?? '', selectedQuantity, selectedQuantityMillis: selectedMillis, unitCost: source.unitCost, shippingCost, itemName: source.itemName ?? '', partNumber: source.partNumber ?? '', unit: source.unit, reason: typeof reason === 'string' ? reason.trim() : '', status: 'active', selectedBy: request.auth!.uid, selectedAt: now, cancelledAt: null })
    transaction.set(stateRef, { rfqItemId, selectedQuantityMillis: used + selectedMillis, updatedAt: now })
  })
  return { decisionId: decisionRef.id }
})

export const cancelSourcingDecision = onCall({ region: 'asia-northeast1' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。')
  const { rfqId, rfqItemId, decisionId } = request.data as Record<string, unknown>
  if (typeof rfqId !== 'string' || typeof rfqItemId !== 'string' || typeof decisionId !== 'string') throw new HttpsError('invalid-argument', '採用情報が不正です。')
  const stateRef = db.doc(`rfqs/${rfqId}/sourcingStates/${rfqItemId}`), decisionRef = db.doc(`rfqs/${rfqId}/items/${rfqItemId}/sourcingDecisions/${decisionId}`)
  await db.runTransaction(async transaction => { const [state, decision] = await Promise.all([transaction.get(stateRef), transaction.get(decisionRef)]); if (!state.exists || !decision.exists || decision.get('status') !== 'active') throw new HttpsError('failed-precondition', '採用状態が変更されています。'); const remaining = Number(state.get('selectedQuantityMillis')) - Number(decision.get('selectedQuantityMillis')); if (!Number.isSafeInteger(remaining) || remaining < 0) throw new HttpsError('failed-precondition', '採用数量の集計が不正です。'); transaction.update(decisionRef, { status: 'cancelled', cancelledAt: new Date(), cancelledBy: request.auth!.uid }); transaction.update(stateRef, { selectedQuantityMillis: remaining, updatedAt: new Date() }) })
  return { cancelled: true }
})
