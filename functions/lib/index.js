"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.freeeOAuthCallback = exports.beginFreeeOAuth = exports.searchRakutenItems = exports.cancelSourcingDecision = exports.selectSourcingCandidate = void 0;
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
function candidateReference(value) {
    if (!value || typeof value !== 'object')
        throw new https_1.HttpsError('invalid-argument', '採用対象が不正です。');
    const candidate = value;
    const sourceType = candidate.sourceType;
    if (typeof candidate.id !== 'string' || !candidate.id || !['supplier_quote', 'amazon', 'rakuten', 'manual'].includes(String(sourceType)))
        throw new https_1.HttpsError('invalid-argument', '候補IDまたは種別が不正です。');
    if (sourceType === 'supplier_quote' && (typeof candidate.sourceQuoteId !== 'string' || !candidate.sourceQuoteId))
        throw new https_1.HttpsError('invalid-argument', '仕入先見積の参照が不正です。');
    return { id: candidate.id, sourceType: sourceType, sourceQuoteId: typeof candidate.sourceQuoteId === 'string' ? candidate.sourceQuoteId : null };
}
function expiredAt(value) {
    return typeof value === 'object' && value !== null && 'toMillis' in value
        && typeof value.toMillis === 'function'
        && value.toMillis() + 86_400_000 <= Date.now();
}
async function loadCandidateSource(transaction, rfqId, rfqItemId, reference) {
    if (reference.sourceType === 'supplier_quote') {
        const quoteRef = db.doc(`supplierQuotes/${reference.sourceQuoteId}`);
        const lineRef = quoteRef.collection('items').doc(reference.id);
        const [quote, line] = await Promise.all([transaction.get(quoteRef), transaction.get(lineRef)]);
        if (!quote.exists || !line.exists || quote.get('rfqId') !== rfqId || quote.get('archivedAt') || quote.get('status') === 'withdrawn' || line.get('rfqId') !== rfqId || line.get('rfqItemId') !== rfqItemId)
            throw new https_1.HttpsError('failed-precondition', '仕入先見積の候補が変更されています。再読込してください。');
        return { sourceType: reference.sourceType, sourceRecordId: reference.id, sourceQuoteId: reference.sourceQuoteId, supplierId: typeof quote.get('supplierId') === 'string' ? quote.get('supplierId') : null, supplierName: typeof quote.get('supplierName') === 'string' ? quote.get('supplierName') : '', itemName: typeof line.get('itemName') === 'string' ? line.get('itemName') : '', partNumber: typeof line.get('partNumber') === 'string' ? line.get('partNumber') : '', unit: typeof line.get('unit') === 'string' ? line.get('unit') : '', quantity: line.get('quantity'), unitCost: line.get('unitPrice'), shippingFee: typeof line.get('shippingFee') === 'number' ? line.get('shippingFee') : null, total: typeof line.get('total') === 'number' ? line.get('total') : null, observedAt: quote.get('quoteDate') ?? null, sourceRevision: typeof line.get('revision') === 'number' ? line.get('revision') : null, expired: expiredAt(quote.get('validUntil')) };
    }
    const offer = await transaction.get(db.doc(`marketplaceOffers/${reference.id}`));
    const expectedType = reference.sourceType === 'manual' ? 'other' : reference.sourceType;
    if (!offer.exists || offer.get('rfqId') !== rfqId || offer.get('rfqItemId') !== rfqItemId || offer.get('source') !== expectedType)
        throw new https_1.HttpsError('failed-precondition', '購入候補が変更されています。再読込してください。');
    return { sourceType: reference.sourceType, sourceRecordId: reference.id, sourceQuoteId: null, supplierId: null, supplierName: typeof offer.get('sellerName') === 'string' ? offer.get('sellerName') : '', itemName: typeof offer.get('itemName') === 'string' ? offer.get('itemName') : '', partNumber: typeof offer.get('partNumber') === 'string' ? offer.get('partNumber') : '', unit: typeof offer.get('unit') === 'string' ? offer.get('unit') : '', quantity: offer.get('quantity'), unitCost: offer.get('unitPrice'), shippingFee: typeof offer.get('shippingFee') === 'number' ? offer.get('shippingFee') : null, total: typeof offer.get('totalPrice') === 'number' ? offer.get('totalPrice') : null, observedAt: offer.get('retrievedAt') ?? null, sourceRevision: null, expired: false };
}
exports.selectSourcingCandidate = (0, https_1.onCall)({ region: 'asia-northeast1', invoker: 'public' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'ログインが必要です。');
    const { rfqId, rfqItemId, candidate, selectedQuantity, shippingCost, reason } = request.data;
    if (typeof rfqId !== 'string' || typeof rfqItemId !== 'string')
        throw new https_1.HttpsError('invalid-argument', '採用対象が不正です。');
    if (typeof shippingCost !== 'number' || !Number.isSafeInteger(shippingCost) || shippingCost < 0)
        throw new https_1.HttpsError('invalid-argument', '送料は0以上の整数円で入力してください。');
    const reference = candidateReference(candidate);
    const selectedMillis = quantityMillis(selectedQuantity);
    const itemRef = db.doc(`rfqs/${rfqId}/items/${rfqItemId}`);
    const stateRef = db.doc(`rfqs/${rfqId}/sourcingStates/${rfqItemId}`);
    const decisionRef = itemRef.collection('sourcingDecisions').doc();
    await db.runTransaction(async (transaction) => {
        const [item, state, source] = await Promise.all([transaction.get(itemRef), transaction.get(stateRef), loadCandidateSource(transaction, rfqId, rfqItemId, reference)]);
        if (!item.exists || item.get('archivedAt') || item.get('status') === 'cancelled' || item.get('unit') !== source.unit)
            throw new https_1.HttpsError('failed-precondition', '案件品目が変更されています。');
        const offeredMillis = quantityMillis(source.quantity);
        if (selectedMillis > offeredMillis)
            throw new https_1.HttpsError('invalid-argument', '採用数量は候補提示数量以下にしてください。');
        if (!Number.isSafeInteger(source.unitCost) || source.unitCost < 0)
            throw new https_1.HttpsError('failed-precondition', '候補単価が不正です。');
        if (source.expired && (typeof reason !== 'string' || !reason.trim()))
            throw new https_1.HttpsError('invalid-argument', '期限切れ候補の採用理由を入力してください。');
        const used = state.exists ? Number(state.get('selectedQuantityMillis') ?? 0) : 0;
        if (!Number.isSafeInteger(used) || used + selectedMillis > quantityMillis(item.get('quantity')))
            throw new https_1.HttpsError('failed-precondition', '採用数量の合計が必要数量を超えます。');
        const now = new Date();
        const sourceSnapshot = { sourceType: source.sourceType, sourceRecordId: source.sourceRecordId, sourceQuoteId: source.sourceQuoteId, supplierId: source.supplierId, supplierName: source.supplierName, itemName: source.itemName, partNumber: source.partNumber, unit: source.unit, offeredQuantity: source.quantity, unitCost: source.unitCost, candidateShippingFee: source.shippingFee, candidateTotal: source.total, observedAt: source.observedAt, sourceRevision: source.sourceRevision };
        const decision = { rfqId, rfqItemId, sourceType: source.sourceType, sourceRecordId: source.sourceRecordId, sourceQuoteId: source.sourceQuoteId, supplierId: source.supplierId, supplierName: source.supplierName, selectedQuantity, selectedQuantityMillis: selectedMillis, unitCost: source.unitCost, shippingCost, itemName: source.itemName, partNumber: source.partNumber, unit: source.unit, reason: typeof reason === 'string' ? reason.trim() : '', status: 'active', selectedBy: request.auth.uid, selectedAt: now, cancelledAt: null, cancelledBy: null, sourceSnapshot, createdAt: now, createdBy: request.auth.uid, updatedAt: now, updatedBy: request.auth.uid };
        transaction.create(decisionRef, decision);
        transaction.set(stateRef, { rfqItemId, selectedQuantityMillis: used + selectedMillis, updatedAt: now });
        audit(transaction, request, { action: 'sourcing_decision_selected', rfqId, decisionId: decisionRef.id, before: null, after: decision, createdAt: now });
    });
    return { decisionId: decisionRef.id };
});
exports.cancelSourcingDecision = (0, https_1.onCall)({ region: 'asia-northeast1', invoker: 'public' }, async (request) => {
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
var rakuten_1 = require("./rakuten");
Object.defineProperty(exports, "searchRakutenItems", { enumerable: true, get: function () { return rakuten_1.searchRakutenItems; } });
var freee_1 = require("./freee");
Object.defineProperty(exports, "beginFreeeOAuth", { enumerable: true, get: function () { return freee_1.beginFreeeOAuth; } });
Object.defineProperty(exports, "freeeOAuthCallback", { enumerable: true, get: function () { return freee_1.freeeOAuthCallback; } });
