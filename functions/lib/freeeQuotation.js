"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileFreeeQuotation = exports.sendFreeeQuotation = exports.saveSalesQuotePricing = void 0;
const node_crypto_1 = require("node:crypto");
const secret_manager_1 = require("@google-cloud/secret-manager");
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const salesQuoteModel_1 = require("./salesQuoteModel");
const freeeQuotationTransport_1 = require("./freeeQuotationTransport");
const tokensSecret = (0, params_1.defineSecret)('FREEE_OAUTH_TOKENS');
const options = { region: 'asia-northeast1', invoker: 'public', secrets: [tokensSecret], timeoutSeconds: 60 };
const manager = new secret_manager_1.SecretManagerServiceClient();
const hash = (value) => (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(value)).digest('hex');
function id(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
        throw new https_1.HttpsError('invalid-argument', 'IDが不正です。');
    return value;
}
function input(value) {
    try {
        return (0, salesQuoteModel_1.record)(value);
    }
    catch {
        throw new https_1.HttpsError('invalid-argument', '入力形式が不正です。');
    }
}
async function connection(requireValidToken) {
    // Read latest explicitly: a deployed secret binding would keep an old OAuth version.
    try {
        const project = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
        const [version] = await manager.accessSecretVersion({ name: `projects/${project}/secrets/${tokensSecret.name}/versions/latest` });
        const token = (0, salesQuoteModel_1.record)(JSON.parse(Buffer.from(version.payload?.data).toString('utf8')));
        const companyId = Number(token.companyId);
        if (!Number.isSafeInteger(companyId) || companyId <= 0 || typeof token.accessToken !== 'string' || !token.accessToken)
            throw new Error('invalid token');
        const expiresAt = typeof token.authorizedAt === 'string' && typeof token.expiresIn === 'number' ? Date.parse(token.authorizedAt) + token.expiresIn * 1000 : 0;
        if (requireValidToken && (!Number.isFinite(expiresAt) || expiresAt < Date.now() + 60_000))
            throw new Error('expired token');
        return { companyId, accessToken: token.accessToken };
    }
    catch {
        throw new https_1.HttpsError('failed-precondition', 'freeeの接続情報が未設定・期限切れ、または読み取り不可です。「freee連携」で再認可してください。');
    }
}
function exportRef(rfqId) { return (0, firestore_1.getFirestore)().doc(`salesQuotes/${rfqId}/freeeExports/current`); }
function mutable(status) { return status === 'draft' || status === 'failed'; }
function eventData(userId, action, revision, values = {}) {
    return { action, revision, userId, createdAt: firestore_1.FieldValue.serverTimestamp(), ...values };
}
exports.saveSalesQuotePricing = (0, https_1.onCall)(options, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'ログインが必要です。');
    const data = input(request.data), rfqId = id(data.rfqId), expectedRevision = data.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0)
        throw new https_1.HttpsError('invalid-argument', '保存版番号が不正です。');
    let settings;
    try {
        settings = (0, salesQuoteModel_1.parseQuoteSettings)(data.settings);
    }
    catch (error) {
        throw new https_1.HttpsError('invalid-argument', error.message);
    }
    const { companyId } = await connection(false);
    const db = (0, firestore_1.getFirestore)(), ref = exportRef(rfqId), userId = request.auth.uid;
    return db.runTransaction(async (transaction) => {
        const [rfq, quote, items, current] = await Promise.all([
            transaction.get(db.doc(`rfqs/${rfqId}`)), transaction.get(db.doc(`salesQuotes/${rfqId}`)),
            transaction.get(db.collection(`salesQuotes/${rfqId}/items`)), transaction.get(ref),
        ]);
        if (!rfq.exists || rfq.get('status') === 'cancelled' || quote.get('status') !== 'confirmed' || items.empty)
            throw new https_1.HttpsError('failed-precondition', '有効なRFQと確定済みの翻訳明細が必要です。');
        const previous = current.data();
        if ((previous?.revision ?? 0) !== expectedRevision)
            throw new https_1.HttpsError('aborted', '別の利用者が更新しました。保存済みの内容を読み直してください。');
        if (previous && !mutable(previous.status))
            throw new https_1.HttpsError('failed-precondition', '送信開始後の販売見積は変更できません。');
        const source = items.docs.map(item => {
            const d = item.data();
            if (d.rfqId !== rfqId || d.rfqItemId !== item.id || !(d.confirmedAt instanceof firestore_1.Timestamp))
                throw new https_1.HttpsError('failed-precondition', '未確定または不整合な翻訳明細があります。');
            return { rfqItemId: item.id, lineNo: d.lineNo, partNumber: d.partNumber, quantity: d.quantity, unit: d.unit,
                originalDescription: d.originalDescription, translatedDescription: d.translatedDescription, outputDescription: d.outputDescription };
        });
        let preview;
        try {
            preview = (0, salesQuoteModel_1.buildQuotePreview)(settings, source);
        }
        catch (error) {
            throw new https_1.HttpsError('failed-precondition', error.message);
        }
        const revision = (previous?.revision ?? 0) + 1;
        const marker = `IEPpurchase:${rfqId}:v${revision}`;
        const payload = (0, salesQuoteModel_1.toFreeePayload)(preview, companyId, marker);
        const saved = { rfqId, revision, status: 'draft', companyId,
            customerId: rfq.get('customerId'), customerName: rfq.get('customerName'),
            preview, marker, payload, digest: hash({ payload, preview }), attempt: previous?.attempt ?? 0, result: null, error: '' };
        if (Buffer.byteLength(JSON.stringify(saved), 'utf8') > 750_000)
            throw new https_1.HttpsError('invalid-argument', '保存する原文・翻訳文が大きすぎます。見積を分けてください。');
        transaction.set(ref, { ...saved, createdAt: current.get('createdAt') ?? firestore_1.FieldValue.serverTimestamp(), updatedAt: firestore_1.FieldValue.serverTimestamp(), updatedBy: userId });
        transaction.create(ref.collection('revisions').doc(String(revision)), { ...saved, ...eventData(userId, 'saved', revision) });
        transaction.create(ref.collection('events').doc(), eventData(userId, 'saved', revision));
        return saved;
    });
});
exports.sendFreeeQuotation = (0, https_1.onCall)(options, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'ログインが必要です。');
    const data = input(request.data), rfqId = id(data.rfqId);
    if (data.confirm !== true || typeof data.digest !== 'string')
        throw new https_1.HttpsError('invalid-argument', '送信プレビューの明示確認が必要です。');
    const ref = exportRef(rfqId), db = (0, firestore_1.getFirestore)(), userId = request.auth.uid;
    const token = await connection(true);
    const claimed = await db.runTransaction(async (transaction) => {
        const [current, rfq] = await Promise.all([transaction.get(ref), transaction.get(db.doc(`rfqs/${rfqId}`))]);
        const saved = current.data();
        if (!saved || saved.digest !== data.digest || saved.revision !== data.revision)
            throw new https_1.HttpsError('aborted', '保存版が変更されました。最新のプレビューを確認してください。');
        if (saved.status === 'sent')
            return { saved, alreadySent: true };
        if (!mutable(saved.status))
            throw new https_1.HttpsError('failed-precondition', '送信中または結果不明のため再作成できません。作成済み見積書IDを照合してください。');
        if (token.companyId !== saved.companyId)
            throw new https_1.HttpsError('failed-precondition', '接続事業所が変わっています。プレビューを保存し直してください。');
        if (!rfq.exists || rfq.get('status') === 'cancelled' || rfq.get('customerId') !== saved.customerId)
            throw new https_1.HttpsError('failed-precondition', 'RFQの状態または顧客が変更されました。');
        transaction.update(ref, { status: 'sending', attempt: saved.attempt + 1, startedAt: firestore_1.FieldValue.serverTimestamp(), updatedAt: firestore_1.FieldValue.serverTimestamp(), error: '' });
        transaction.create(ref.collection('events').doc(), eventData(userId, 'sending', saved.revision, { attempt: saved.attempt + 1, digest: saved.digest }));
        return { saved, alreadySent: false };
    });
    if (claimed.alreadySent)
        return { status: 'sent', result: claimed.saved.result };
    const saved = claimed.saved;
    let result;
    try {
        result = await (0, freeeQuotationTransport_1.createFreeeQuotation)(saved.payload, token.accessToken, saved.preview.total, saved.preview.tax);
    }
    catch (error) {
        const known = error instanceof freeeQuotationTransport_1.FreeeRequestError;
        const status = known && error.retryable ? 'failed' : 'uncertain';
        const message = known ? error.message : '登録結果が不明です。freeeで作成結果を確認してください。';
        const batch = db.batch();
        batch.update(ref, { status, error: message, updatedAt: firestore_1.FieldValue.serverTimestamp() });
        batch.create(ref.collection('events').doc(), eventData(userId, status, saved.revision, { message }));
        await batch.commit();
        return { status, result: null, error: message };
    }
    // If this commit fails, status stays sending. Never perform a second POST.
    const batch = db.batch();
    batch.update(ref, { status: 'sent', result, error: '', updatedAt: firestore_1.FieldValue.serverTimestamp() });
    batch.create(ref.collection('events').doc(), eventData(userId, 'sent', saved.revision, { result }));
    await batch.commit();
    return { status: 'sent', result };
});
exports.reconcileFreeeQuotation = (0, https_1.onCall)(options, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'ログインが必要です。');
    const data = input(request.data), rfqId = id(data.rfqId);
    if (!Number.isSafeInteger(data.quotationId) || Number(data.quotationId) <= 0)
        throw new https_1.HttpsError('invalid-argument', '作成済みfreee見積書IDを入力してください。');
    const ref = exportRef(rfqId), current = await ref.get(), saved = current.data();
    if (!saved || !['sending', 'uncertain'].includes(saved.status))
        throw new https_1.HttpsError('failed-precondition', '結果不明の見積のみ照合できます。');
    if (saved.startedAt && Date.now() - saved.startedAt.toMillis() < 120_000)
        throw new https_1.HttpsError('failed-precondition', '送信処理の完了を待っています。2分後に照合してください。');
    const token = await connection(true);
    if (token.companyId !== saved.companyId)
        throw new https_1.HttpsError('failed-precondition', '元の事業所に再接続してください。');
    let result;
    try {
        const response = await fetch(`https://api.freee.co.jp/iv/quotations/${data.quotationId}?company_id=${saved.companyId}`, { headers: { authorization: `Bearer ${token.accessToken}` }, signal: AbortSignal.timeout(25_000), redirect: 'error' });
        if (!response.ok)
            throw new Error('lookup failed');
        const body = await response.json(), q = (0, salesQuoteModel_1.record)((0, salesQuoteModel_1.record)(body).quotation);
        if (q.id !== data.quotationId || q.memo !== saved.marker || q.partner_id !== saved.payload.partner_id)
            throw new Error('not the same export');
        result = (0, freeeQuotationTransport_1.freeeResult)(body, saved.payload, saved.preview.total, saved.preview.tax);
    }
    catch {
        throw new https_1.HttpsError('failed-precondition', 'この送信に対応するfreee見積書を確認できません。事業所・見積書ID・社内メモを確認してください。再作成は停止したままです。');
    }
    await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
        const latest = (await transaction.get(ref)).data();
        if (latest.digest !== saved.digest || !['sending', 'uncertain'].includes(latest.status))
            throw new https_1.HttpsError('aborted', '状態が変更されました。再読込してください。');
        transaction.update(ref, { status: 'sent', result, error: '', updatedAt: firestore_1.FieldValue.serverTimestamp() });
        transaction.create(ref.collection('events').doc(), eventData(request.auth.uid, 'reconciled', saved.revision, { result }));
    });
    return { status: 'sent', result };
});
