"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changeSalesQuoteTranslation = void 0;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const maxQuoteItems = 100;
const isActive = (item) => item.get('archivedAt') == null && item.get('status') !== 'cancelled';
const text = (value) => typeof value === 'string' ? value : '';
function lineLabel(item) {
    const lineNo = item.get('lineNo');
    const partNumber = text(item.get('partNumber')).trim();
    return `明細 No. ${Number.isSafeInteger(lineNo) && lineNo > 0 ? lineNo : '未設定'}${partNumber ? `（品番 ${partNumber}）` : ''}`;
}
function sourceIssues(item) {
    const issues = [];
    const quantity = item.get('quantity');
    if (!text(item.get('originalDescription')).trim())
        issues.push('品目説明（原文）を入力してください。');
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0)
        issues.push('数量に0より大きい数値を入力してください。');
    if (!text(item.get('unit')).trim())
        issues.push('単位を入力してください。');
    if (Array.from(text(item.get('translatedDescription'))).length > 5000)
        issues.push('翻訳説明を5000文字以内に修正してください。');
    const lineNo = item.get('lineNo');
    if (!Number.isSafeInteger(lineNo) || lineNo <= 0)
        issues.push('明細番号を取得できません。管理者にご連絡ください。');
    return issues;
}
function expectedVersions(value) {
    if (!Array.isArray(value) || value.length > maxQuoteItems)
        throw new https_1.HttpsError('invalid-argument', '明細を再読み込みしてください。');
    const versions = new Map();
    for (const entry of value) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string' || versions.has(entry[0])) {
            throw new https_1.HttpsError('invalid-argument', '明細の状態が不正です。再読み込みしてください。');
        }
        versions.set(entry[0], entry[1]);
    }
    return versions;
}
exports.changeSalesQuoteTranslation = (0, https_1.onCall)({ region: 'asia-northeast1', invoker: 'public' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'ログインしてください。');
    const { rfqId, action, expectedItems } = (request.data ?? {});
    if (typeof rfqId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(rfqId) || (action !== 'import' && action !== 'reimport' && action !== 'reopen' && action !== 'confirm')) {
        throw new https_1.HttpsError('invalid-argument', '販売見積の操作または案件IDが不正です。');
    }
    const importing = action === 'import' || action === 'reimport';
    const versions = action === 'import' ? null : expectedVersions(expectedItems);
    const db = (0, firestore_1.getFirestore)();
    const rfqRef = db.collection('rfqs').doc(rfqId);
    const quoteRef = db.collection('salesQuotes').doc(rfqId);
    await db.runTransaction(async (transaction) => {
        const [rfq, quote, saved, source, items] = await Promise.all([
            transaction.get(rfqRef), transaction.get(quoteRef), transaction.get(quoteRef.collection('freeeExports').doc('current')),
            transaction.get(rfqRef.collection('items')), transaction.get(quoteRef.collection('items')),
        ]);
        if (!rfq.exists)
            throw new https_1.HttpsError('not-found', 'RFQ案件が見つかりません。RFQ一覧から開き直してください。');
        if (saved.exists && !(saved.get('editing') === true && saved.get('status') === 'draft')) {
            throw new https_1.HttpsError('failed-precondition', '販売見積の保存状態を確認してください。転記中・結果不明の場合は先に照合し、保存済みの場合は「改訂版を作成して編集」から開始してください。');
        }
        if (action === 'import' ? quote.exists : !quote.exists)
            throw new https_1.HttpsError('aborted', '明細の状態が更新されました。最新の内容を確認してから再試行してください。');
        if (versions && (versions.size !== items.size || items.docs.some(item => {
            const stamp = item.get('updatedAt');
            return versions.get(item.id) !== (stamp instanceof firestore_1.Timestamp ? `${stamp.seconds}:${stamp.nanoseconds}` : '');
        })))
            throw new https_1.HttpsError('aborted', '明細が変更されています。最新の内容を確認してから再試行してください。');
        const updatedAt = firestore_1.FieldValue.serverTimestamp();
        const active = source.docs.filter(isActive);
        const activeIds = new Set(active.map(item => item.id));
        if (importing) {
            if (!active.length)
                throw new https_1.HttpsError('failed-precondition', source.empty
                    ? 'RFQ品目が登録されていません。「品目を追加」で品目を登録してください。'
                    : 'すべてのRFQ品目が削除済みまたはキャンセルです。対象を復元するか、状態を変更してください。');
            if (active.length > maxQuoteItems)
                throw new https_1.HttpsError('failed-precondition', `有効なRFQ品目が${active.length}件あります。販売見積は100明細まで対応しています。`);
            const issues = active.sort((a, b) => (a.get('lineNo') ?? 0) - (b.get('lineNo') ?? 0)).flatMap(item => {
                const messages = sourceIssues(item);
                return messages.length ? [`${lineLabel(item)}：${messages.join(' ')}`] : [];
            });
            if (issues.length)
                throw new https_1.HttpsError('failed-precondition', ['RFQ品目の「編集」で次の欄を確認してください。', ...issues].join('\n'));
            const existing = new Map(items.docs.map(item => [item.id, item]));
            for (const item of active) {
                const translatedDescription = text(item.get('translatedDescription'));
                transaction.set(quoteRef.collection('items').doc(item.id), {
                    rfqId, rfqItemId: item.id, lineNo: item.get('lineNo'), partNumber: text(item.get('partNumber')),
                    quantity: item.get('quantity'), unit: item.get('unit'), originalDescription: item.get('originalDescription'),
                    translatedDescription, outputDescription: translatedDescription, confirmedAt: null,
                    createdAt: existing.get(item.id)?.get('createdAt') ?? updatedAt, updatedAt,
                });
            }
            for (const item of items.docs)
                if (!activeIds.has(item.id))
                    transaction.delete(item.ref);
            if (quote.exists)
                transaction.update(quoteRef, { status: 'draft', confirmedAt: null, updatedAt });
            else
                transaction.create(quoteRef, { rfqId, status: 'draft', confirmedAt: null, createdAt: updatedAt, updatedAt });
            return;
        }
        if (quote.get('status') !== (action === 'confirm' ? 'draft' : 'confirmed'))
            throw new https_1.HttpsError('aborted', '明細の確定状態が変更されています。最新の内容を確認してください。');
        if (items.empty)
            throw new https_1.HttpsError('failed-precondition', '明細がありません。「RFQ品目を再取り込み」を実行してください。');
        const inactive = items.docs.filter(item => !activeIds.has(item.id));
        if (inactive.length)
            throw new https_1.HttpsError('failed-precondition', ['削除・キャンセル済み、または見つからないRFQ品目があります。「RFQ品目を再取り込み」を実行してください。', ...inactive.map(lineLabel)].join('\n'));
        if (action === 'confirm') {
            const missing = items.docs.filter(item => !text(item.get('outputDescription')).trim());
            if (missing.length)
                throw new https_1.HttpsError('failed-precondition', ['「確認・修正」で次の行の「見積用の出力文」を入力してください。', ...missing.map(lineLabel)].join('\n'));
        }
        const status = action === 'confirm' ? 'confirmed' : 'draft';
        const confirmedAt = action === 'confirm' ? updatedAt : null;
        transaction.update(quoteRef, { status, confirmedAt, updatedAt });
        for (const item of items.docs)
            transaction.update(item.ref, { confirmedAt, updatedAt });
    });
});
