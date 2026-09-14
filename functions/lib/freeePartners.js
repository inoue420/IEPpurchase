"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePartner = parsePartner;
exports.readFreeePartners = readFreeePartners;
const https_1 = require("firebase-functions/v2/https");
const salesQuoteModel_1 = require("./salesQuoteModel");
function parsePartner(value) {
    const p = (0, salesQuoteModel_1.record)(value);
    if (!Number.isSafeInteger(p.id) || Number(p.id) <= 0 || typeof p.name !== 'string' || !p.name.trim() || p.available === false)
        throw new https_1.HttpsError('failed-precondition', '利用可能なfreee取引先を確認できません。選び直してください。');
    return { id: Number(p.id), name: p.name, code: typeof p.code === 'string' ? p.code : '' };
}
async function readFreeePartners(path, token, fetcher = fetch) {
    try {
        const response = await fetcher(`https://api.freee.co.jp/api/1/partners${path}`, { method: 'GET', headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
        if (!response.ok)
            throw new https_1.HttpsError('failed-precondition', response.status === 401
                ? 'freeeの認証期限が切れています。「freee連携」で再認可してください。'
                : response.status === 403 ? 'freeeの取引先を参照できません。アプリの取引先参照権限と事業所へのアクセス権限を確認してください。'
                    : `freee取引先を取得できませんでした（HTTP ${response.status}）。時間をおいて再検索してください。`);
        return (0, salesQuoteModel_1.record)(await response.json());
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError('unavailable', 'freee取引先を取得できませんでした。接続を確認して再検索してください。');
    }
}
