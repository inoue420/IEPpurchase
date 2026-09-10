"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchRakutenItems = void 0;
exports.parseRakutenItems = parseRakutenItems;
exports.parseRakutenKeyword = parseRakutenKeyword;
exports.fetchRakutenItems = fetchRakutenItems;
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const applicationId = (0, params_1.defineSecret)('RAKUTEN_APPLICATION_ID');
const accessKey = (0, params_1.defineSecret)('RAKUTEN_ACCESS_KEY');
const siteUrl = (0, params_1.defineString)('RAKUTEN_SITE_URL', { default: '', description: '楽天アプリに登録した許可WebサイトURL' });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const flag = (value) => value === 0 || value === 1 ? value : null;
function parseRakutenItems(body) {
    const data = record(body);
    const values = data.Items ?? data.items;
    if (!Array.isArray(values))
        throw new https_1.HttpsError('unavailable', '楽天の検索結果を読み取れませんでした。');
    return values.flatMap(value => {
        const item = record(value);
        if (typeof item.itemCode !== 'string' || !item.itemCode || item.itemCode.length > 200 || typeof item.itemName !== 'string' || !item.itemName || item.itemName.length > 500 || typeof item.shopName !== 'string' || item.shopName.length > 200 || typeof item.itemPrice !== 'number' || !Number.isSafeInteger(item.itemPrice) || item.itemPrice < 0 || item.itemPrice > 1_000_000_000 || typeof item.itemUrl !== 'string')
            return [];
        try {
            const url = new URL(item.itemUrl);
            if (url.protocol !== 'https:' || !(url.hostname === 'rakuten.co.jp' || url.hostname.endsWith('.rakuten.co.jp')) || url.username || url.password)
                return [];
        }
        catch {
            return [];
        }
        return [{ itemCode: item.itemCode, itemName: item.itemName, itemPrice: item.itemPrice, itemUrl: item.itemUrl, shopName: item.shopName, taxFlag: flag(item.taxFlag), postageFlag: flag(item.postageFlag), availability: flag(item.availability) }];
    });
}
function parseRakutenKeyword(data) {
    const keyword = record(data).keyword;
    if (typeof keyword !== 'string' || !keyword.trim() || Buffer.byteLength(keyword.trim(), 'utf8') > 128)
        throw new https_1.HttpsError('invalid-argument', '検索語を128バイト以内で入力してください。');
    return keyword.trim();
}
async function fetchRakutenItems(keyword, appId, key, fetcher = fetch, website = '') {
    if (!appId || !key)
        throw new https_1.HttpsError('failed-precondition', '楽天の認証設定を確認してください。');
    let origin;
    try {
        const site = new URL(website);
        if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password)
            throw new Error();
        origin = site.origin;
    }
    catch {
        throw new https_1.HttpsError('failed-precondition', '楽天の許可WebサイトURLを設定してください。');
    }
    const url = new URL('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701');
    url.search = new URLSearchParams({ applicationId: appId, keyword, format: 'json', formatVersion: '2', hits: '20', page: '1', availability: '0' }).toString();
    try {
        const response = await fetcher(url, { headers: { accessKey: key, Referer: website, Origin: origin }, signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (response.status === 404)
            return { items: [], retrievedAt: new Date().toISOString() };
        if (response.status === 429)
            throw new https_1.HttpsError('resource-exhausted', '楽天の検索制限に達しました。しばらく待って再検索してください。');
        if ([400, 401, 403].includes(response.status))
            throw new https_1.HttpsError('failed-precondition', '楽天検索が拒否されました。検索語と楽天側の認証・許可設定を確認してください。');
        if (!response.ok)
            throw new https_1.HttpsError('unavailable', '楽天検索を利用できません。時間をおいて再検索してください。');
        return { items: parseRakutenItems(await response.json()), retrievedAt: new Date().toISOString() };
    }
    catch (error) {
        // Never expose upstream response bodies, request URLs or credentials.
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError('unavailable', '楽天検索に接続できませんでした。時間をおいて再検索してください。');
    }
}
exports.searchRakutenItems = (0, https_1.onCall)({ region: 'asia-northeast1', invoker: 'public', secrets: [applicationId, accessKey], timeoutSeconds: 30, maxInstances: 1, concurrency: 1 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'ログインが必要です。');
    const keyword = parseRakutenKeyword(request.data);
    return fetchRakutenItems(keyword, applicationId.value(), accessKey.value(), fetch, siteUrl.value());
});
