"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FreeeRequestError = void 0;
exports.freeeResult = freeeResult;
exports.createFreeeQuotation = createFreeeQuotation;
const salesQuoteModel_1 = require("./salesQuoteModel");
class FreeeRequestError extends Error {
    retryable;
    constructor(retryable, message) {
        super(message);
        this.retryable = retryable;
    }
}
exports.FreeeRequestError = FreeeRequestError;
function freeeResult(value, payload, expectedTotal, expectedTax) {
    const q = (0, salesQuoteModel_1.record)((0, salesQuoteModel_1.record)(value).quotation);
    if (!Number.isSafeInteger(q.id) || Number(q.id) <= 0 || q.company_id !== payload.company_id)
        throw new Error('freeeの作成結果を特定できません。');
    let reportUrl = '';
    if (typeof q.report_url === 'string') {
        try {
            const url = new URL(q.report_url);
            if (url.protocol === 'https:' && (url.hostname === 'freee.co.jp' || url.hostname.endsWith('.freee.co.jp')) && !url.username && !url.password)
                reportUrl = url.toString();
        }
        catch { /* Do not expose an untrusted link. */ }
    }
    const lines = Array.isArray(q.lines) ? q.lines : [];
    const matched = q.partner_id === payload.partner_id && q.total_amount === expectedTotal && q.amount_tax === expectedTax
        && lines.length === payload.lines.length && lines.every((value, i) => {
        const line = (0, salesQuoteModel_1.record)(value), expected = payload.lines[i];
        return line.description === expected.description && line.quantity === expected.quantity && line.unit === expected.unit
            && Number(line.unit_price) === Number(expected.unit_price) && line.tax_rate === expected.tax_rate
            && line.reduced_tax_rate === expected.reduced_tax_rate && line.withholding === false;
    });
    return { id: Number(q.id), number: typeof q.quotation_number === 'string' ? q.quotation_number : '', reportUrl,
        total: typeof q.total_amount === 'number' ? q.total_amount : null, tax: typeof q.amount_tax === 'number' ? q.amount_tax : null,
        verification: matched ? 'matched' : 'needs_review' };
}
async function createFreeeQuotation(payload, token, total, tax, fetcher = fetch) {
    let response;
    try {
        response = await fetcher('https://api.freee.co.jp/iv/quotations', {
            method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(payload), signal: AbortSignal.timeout(25_000),
        });
    }
    catch {
        throw new FreeeRequestError(false, '通信が中断されました。freeeで作成結果を確認し、作成済み見積書IDを照合してください。再作成は停止しています。');
    }
    if (!response.ok) {
        const retryable = [400, 401, 403, 404, 422, 429].includes(response.status);
        throw new FreeeRequestError(retryable, retryable
            ? `freeeが登録を拒否しました（HTTP ${response.status}）。入力・権限を確認してください。401の場合はfreee連携を再認可してください。`
            : `freeeの登録結果が不明です（HTTP ${response.status}）。freeeで作成結果を確認してください。再作成は停止しています。`);
    }
    try {
        return freeeResult(await response.json(), payload, total, tax);
    }
    catch {
        throw new FreeeRequestError(false, 'freeeの応答を確認できません。作成済みの可能性があるため、見積書IDを照合してください。');
    }
}
