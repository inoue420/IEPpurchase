"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelSourcingDecision = exports.selectSourcingCandidate = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
const MILLIS = 1000;
function quantityMillis(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !/^\d+(\.\d{1,3})?$/.test(String(value)))
        throw new https_1.HttpsError('invalid-argument', '数量は0より大きく小数3桁以内で入力してください。');
    const [whole, fraction = ''] = String(value).split('.');
    return Number(whole) * MILLIS + Number(fraction.padEnd(3, '0'));
}
function audit(transaction, request, values) {
    const userId = request.auth.uid;
    const email = request.auth.token.email;
    transaction.create(db.collection('auditLogs').doc(), { ...values, entityType: 'sourcingDecision', entityId: values.decisionId, userId, userName: typeof email === 'string' ? email : userId });
}
exports.selectSourcingCandidate = (0, https_1.onCall)({ region: 'asia-northeast1' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'ログインが必要です。');
    const { rfqId, rfqItemId, candidate, selectedQuantity, shippingCost, reason } = request.data;
    if (typeof rfqId !== 'string' || typeof rfqItemId !== 'string' || !candidate || typeof candidate !== 'object')
        throw new https_1.HttpsError('invalid-argument', '採用対象が不正です。');
    if (typeof shippingCost !== 'number' || !Number.isSafeInteger(shippingCost) || shippingCost < 0)
        throw new https_1.HttpsError('invalid-argument', '送料は0以上の整数円で入力してください。');
    const source = candidate;
    const selectedMillis = quantityMillis(selectedQuantity);
    const offeredMillis = quantityMillis(source.quantity);
    if (selectedMillis > offeredMillis)
        throw new https_1.HttpsError('invalid-argument', '採用数量は候補提示数量以下にしてください。');
    if (typeof source.unitCost !== 'number' || !Number.isSafeInteger(source.unitCost) || source.unitCost < 0)
        throw new https_1.HttpsError('invalid-argument', '候補単価が不正です。');
    if (source.expired === true && (typeof reason !== 'string' || !reason.trim()))
        throw new https_1.HttpsError('invalid-argument', '期限切れ候補の採用理由を入力してください。');
    const itemRef = db.doc(`rfqs/${rfqId}/items/${rfqItemId}`);
    const stateRef = db.doc(`rfqs/${rfqId}/sourcingStates/${rfqItemId}`);
    const decisionRef = itemRef.collection('sourcingDecisions').doc();
    await db.runTransaction(async (transaction) => {
        const [item, state] = await Promise.all([transaction.get(itemRef), transaction.get(stateRef)]);
        if (!item.exists || item.get('archivedAt') || item.get('status') === 'cancelled' || item.get('unit') !== source.unit)
            throw new https_1.HttpsError('failed-precondition', '案件品目が変更されています。');
        const used = state.exists ? Number(state.get('selectedQuantityMillis') ?? 0) : 0;
        if (!Number.isSafeInteger(used) || used + selectedMillis > quantityMillis(item.get('quantity')))
            throw new https_1.HttpsError('failed-precondition', '採用数量の合計が必要数量を超えます。');
        const now = new Date();
        const sourceSnapshot = { sourceType: source.sourceType, sourceRecordId: source.id, sourceQuoteId: source.sourceQuoteId ?? null, supplierId: source.supplierId ?? null, supplierName: source.seller ?? '', itemName: source.itemName ?? '', partNumber: source.partNumber ?? '', unit: source.unit, offeredQuantity: source.quantity, unitCost: source.unitCost, candidateShippingFee: source.shippingFee ?? null, candidateTotal: source.total ?? null, observedAt: source.observedAt ?? null, sourceRevision: source.sourceRevision ?? null };
        const decision = { rfqId, rfqItemId, sourceType: source.sourceType, sourceRecordId: source.id, sourceQuoteId: source.sourceQuoteId ?? null, supplierId: source.supplierId ?? null, supplierName: source.seller ?? '', selectedQuantity, selectedQuantityMillis: selectedMillis, unitCost: source.unitCost, shippingCost, itemName: source.itemName ?? '', partNumber: source.partNumber ?? '', unit: source.unit, reason: typeof reason === 'string' ? reason.trim() : '', status: 'active', selectedBy: request.auth.uid, selectedAt: now, cancelledAt: null, cancelledBy: null, sourceSnapshot, createdAt: now, createdBy: request.auth.uid, updatedAt: now, updatedBy: request.auth.uid };
        transaction.create(decisionRef, decision);
        transaction.set(stateRef, { rfqItemId, selectedQuantityMillis: used + selectedMillis, updatedAt: now });
        audit(transaction, request, { action: 'sourcing_decision_selected', rfqId, decisionId: decisionRef.id, before: null, after: decision, createdAt: now });
    });
    return { decisionId: decisionRef.id };
});
exports.cancelSourcingDecision = (0, https_1.onCall)({ region: 'asia-northeast1' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'ログインが必要です。');
    const { rfqId, rfqItemId, decisionId } = request.data;
    if (typeof rfqId !== 'string' || typeof rfqItemId !== 'string' || typeof decisionId !== 'string')
        throw new https_1.HttpsError('invalid-argument', '採用情報が不正です。');
    const stateRef = db.doc(`rfqs/${rfqId}/sourcingStates/${rfqItemId}`);
    const decisionRef = db.doc(`rfqs/${rfqId}/items/${rfqItemId}/sourcingDecisions/${decisionId}`);
    await db.runTransaction(async (transaction) => {
        const [state, decision] = await Promise.all([transaction.get(stateRef), transaction.get(decisionRef)]);
        if (!state.exists || !decision.exists || decision.get('status') !== 'active')
            throw new https_1.HttpsError('failed-precondition', '採用状態が変更されています。');
        const remaining = Number(state.get('selectedQuantityMillis')) - Number(decision.get('selectedQuantityMillis'));
        if (!Number.isSafeInteger(remaining) || remaining < 0)
            throw new https_1.HttpsError('failed-precondition', '採用数量の集計が不正です。');
        const now = new Date();
        const before = decision.data();
        const after = { ...before, status: 'cancelled', cancelledAt: now, cancelledBy: request.auth.uid, updatedAt: now, updatedBy: request.auth.uid };
        transaction.update(decisionRef, { status: 'cancelled', cancelledAt: now, cancelledBy: request.auth.uid, updatedAt: now, updatedBy: request.auth.uid });
        transaction.update(stateRef, { selectedQuantityMillis: remaining, updatedAt: now });
        audit(transaction, request, { action: 'sourcing_decision_cancelled', rfqId, decisionId, before, after, createdAt: now });
    });
    return { cancelled: true };
});
