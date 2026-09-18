"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractVisionOcrText = void 0;
exports.layoutVisionText = layoutVisionText;
exports.extractVisionText = extractVisionText;
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const REGION = 'asia-northeast1';
const visionApiKey = (0, params_1.defineSecret)('GOOGLE_CLOUD_VISION_API_KEY');
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TEXT_LENGTH = 50_000;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/x-icon']);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = (value) => Array.isArray(value) ? value : [];
const numberValue = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const columnLabels = { manufacturerName: 'メーカー名', originalDescription: '詳細', quantity: '数量', unit: '単位', partNumber: '品番' };
function positionedWord(value) {
    const word = record(value);
    const text = list(word.symbols).map(symbol => {
        const candidate = record(symbol).text;
        return typeof candidate === 'string' ? candidate : '';
    }).join('').trim();
    const vertices = list(record(word.boundingBox).vertices).map(vertex => record(vertex));
    const xs = vertices.map(vertex => numberValue(vertex.x)).filter((value) => value !== null);
    const ys = vertices.map(vertex => numberValue(vertex.y)).filter((value) => value !== null);
    if (!text || xs.length === 0 || ys.length === 0)
        return null;
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return { text, left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2, height: Math.max(1, bottom - top) };
}
function columnKey(value) {
    const normalized = value.normalize('NFKC').replace(/[\s:：]/g, '').toLowerCase();
    if (['メーカー', 'メーカー名', '製造元', 'brand'].includes(normalized))
        return 'manufacturerName';
    if (['製品名', '商品名', '品名', '品目説明', '詳細', '内容', 'description'].includes(normalized))
        return 'originalDescription';
    if (['数量', 'qty', 'quantity'].includes(normalized))
        return 'quantity';
    if (['単位', 'unit'].includes(normalized))
        return 'unit';
    if (['品番', '型番', 'partno', 'partnumber'].includes(normalized))
        return 'partNumber';
    return null;
}
function pageLayoutText(value) {
    const page = record(value);
    const words = list(page.blocks).flatMap(block => list(record(block).paragraphs))
        .flatMap(paragraph => list(record(paragraph).words)).map(positionedWord).filter((word) => word !== null)
        .sort((a, b) => a.centerY - b.centerY || a.left - b.left);
    if (words.length === 0)
        return '';
    const rows = [];
    for (const word of words) {
        const row = rows.find(candidate => Math.abs(candidate.centerY - word.centerY) <= Math.max(candidate.height, word.height) * 0.6);
        if (row) {
            row.words.push(word);
            const count = row.words.length;
            row.centerY = (row.centerY * (count - 1) + word.centerY) / count;
            row.height = Math.max(row.height, word.height);
        }
        else
            rows.push({ centerY: word.centerY, height: word.height, words: [word] });
    }
    rows.sort((a, b) => a.centerY - b.centerY).forEach(row => row.words.sort((a, b) => a.left - b.left));
    const headerIndex = rows.findIndex(row => row.words.map(word => ({ word, key: columnKey(word.text) })).filter(value => value.key).length >= 2);
    if (headerIndex < 0)
        return '';
    const headerColumns = rows[headerIndex].words.flatMap(word => {
        const key = columnKey(word.text);
        return key ? [{ key, centerX: word.centerX, left: word.left, width: word.right - word.left }] : [];
    }).filter((column, index, values) => values.findIndex(value => value.key === column.key) === index).sort((a, b) => a.centerX - b.centerX);
    if (headerColumns.length < 2)
        return '';
    const pageWidth = numberValue(page.width) ?? Math.max(...words.map(word => word.right));
    const firstAcceptedX = headerColumns[0].left - Math.max(8, Math.min(pageWidth * 0.02, headerColumns[0].width));
    const boundaries = headerColumns.slice(0, -1).map((column, index) => (column.centerX + headerColumns[index + 1].centerX) / 2);
    const lines = [headerColumns.map(column => columnLabels[column.key]).join('\t')];
    for (const row of rows.slice(headerIndex + 1)) {
        const cells = headerColumns.map(() => []);
        for (const word of row.words) {
            if (word.centerX < firstAcceptedX)
                continue;
            const columnIndex = boundaries.findIndex(boundary => word.centerX < boundary);
            cells[columnIndex < 0 ? cells.length - 1 : columnIndex].push(word);
        }
        const values = cells.map(cell => cell.sort((a, b) => a.left - b.left).map(word => word.text).join(' ').trim());
        if (values.some(Boolean))
            lines.push(values.join('\t'));
    }
    return lines.length > 1 ? lines.join('\n') : '';
}
function layoutVisionText(annotationValue) {
    const annotation = record(annotationValue);
    return list(annotation.pages).map(pageLayoutText).filter(Boolean).join('\n');
}
function requestData(value) {
    const data = record(value);
    if (typeof data.mimeType !== 'string' || (!imageTypes.has(data.mimeType) && data.mimeType !== 'application/pdf'))
        throw new https_1.HttpsError('invalid-argument', 'JPEG、PNG、GIF、WebP、BMP、ICO、PDFのいずれかを選択してください。');
    if (typeof data.contentBase64 !== 'string' || !data.contentBase64 || data.contentBase64.length > Math.ceil(MAX_FILE_SIZE * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.contentBase64))
        throw new https_1.HttpsError('invalid-argument', 'ファイル内容が不正です。');
    const byteLength = Buffer.byteLength(data.contentBase64, 'base64');
    if (byteLength <= 0 || byteLength > MAX_FILE_SIZE)
        throw new https_1.HttpsError('invalid-argument', 'ファイルは10MB以下にしてください。');
    return { mimeType: data.mimeType, contentBase64: data.contentBase64 };
}
function confidences(value) {
    const node = record(value);
    const current = typeof node.confidence === 'number' && Number.isFinite(node.confidence) ? [node.confidence] : [];
    const children = ['pages', 'blocks', 'paragraphs', 'words', 'symbols'].flatMap(key => Array.isArray(node[key]) ? node[key] : []);
    return [...current, ...children.flatMap(confidences)];
}
async function callVision(path, body, apiKey, fetcher = fetch) {
    if (!apiKey)
        throw new https_1.HttpsError('failed-precondition', 'Google Cloud Visionの認証設定を確認してください。');
    const url = new URL(`https://vision.googleapis.com/v1/${path}`);
    url.searchParams.set('key', apiKey);
    let response;
    try {
        response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000), redirect: 'error' });
    }
    catch {
        throw new https_1.HttpsError('unavailable', 'Google Cloud Visionに接続できませんでした。時間をおいて再試行してください。');
    }
    if ([400, 401, 403].includes(response.status))
        throw new https_1.HttpsError('failed-precondition', 'Google Cloud Vision APIの有効化、認証、利用設定を確認してください。');
    if (response.status === 429)
        throw new https_1.HttpsError('resource-exhausted', 'Google Cloud Visionの利用上限に達しました。');
    if (!response.ok)
        throw new https_1.HttpsError('unavailable', 'Google Cloud Visionを利用できません。時間をおいて再試行してください。');
    try {
        return record(await response.json());
    }
    catch {
        throw new https_1.HttpsError('unavailable', 'Google Cloud Visionの応答を読み取れませんでした。');
    }
}
async function extractVisionText(input, apiKey, fetcher = fetch) {
    const feature = { type: 'DOCUMENT_TEXT_DETECTION' };
    const body = input.mimeType === 'application/pdf' ? { requests: [{ inputConfig: { content: input.contentBase64, mimeType: input.mimeType }, features: [feature], pages: Array.from({ length: 5 }, (_, index) => index + 1) }] } : { requests: [{ image: { content: input.contentBase64 }, features: [feature] }] };
    const result = await callVision(input.mimeType === 'application/pdf' ? 'files:annotate' : 'images:annotate', body, apiKey, fetcher);
    const outerResponses = Array.isArray(result.responses) ? result.responses.map(record) : [];
    const responses = input.mimeType === 'application/pdf'
        ? outerResponses.flatMap(response => Array.isArray(response.responses) ? response.responses.map(record) : [])
        : outerResponses;
    if (outerResponses.some(response => record(response.error).message))
        throw new https_1.HttpsError('failed-precondition', 'OCRできませんでした。PDFのページ数、形式、暗号化状態を確認してください。');
    if (responses.some(response => record(response.error).message))
        throw new https_1.HttpsError('failed-precondition', 'OCRできませんでした。画像の向き、鮮明さ、PDFのページ数を確認してください。');
    const text = responses.map(response => {
        const annotation = record(response.fullTextAnnotation);
        const layoutText = layoutVisionText(annotation);
        return layoutText || (typeof annotation.text === 'string' ? annotation.text : '');
    }).filter(Boolean).join('\n').trim();
    if (!text)
        throw new https_1.HttpsError('failed-precondition', '文字を抽出できませんでした。画像を鮮明にして再試行してください。');
    const values = responses.flatMap(response => confidences(response.fullTextAnnotation)).filter(value => value >= 0 && value <= 1);
    return { text: text.slice(0, MAX_TEXT_LENGTH), confidence: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, pageCount: responses.length };
}
exports.extractVisionOcrText = (0, https_1.onCall)({ region: REGION, invoker: 'public', secrets: [visionApiKey], timeoutSeconds: 90, maxInstances: 1, concurrency: 2 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'ログインが必要です。');
    return extractVisionText(requestData(request.data), visionApiKey.value());
});
