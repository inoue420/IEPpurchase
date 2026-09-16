"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.record = record;
exports.calculateSalesUnitPrice = calculateSalesUnitPrice;
exports.parseQuoteSettings = parseQuoteSettings;
exports.hasUnsupportedFreeeDescription = hasUnsupportedFreeeDescription;
exports.freeeDescription = freeeDescription;
exports.buildQuotePreview = buildQuotePreview;
exports.toFreeePayload = toFreeePayload;
function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('入力形式が不正です。');
    return value;
}
function text(value, label, max, required = true) {
    if (typeof value !== 'string' || (required && !value.trim()) || [...value].length > max)
        throw new Error(`${label}は${required ? '1〜' : ''}${max}文字以内で入力してください。`);
    return value;
}
function date(value, label, optional = false) {
    if (optional && value === '')
        return '';
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
        throw new Error(`${label}を正しく入力してください。`);
    return value;
}
function choice(value, choices, label) {
    if (!choices.includes(value))
        throw new Error(`${label}が不正です。`);
    return value;
}
function optionalMoney(value, label) {
    if (value === undefined || value === '')
        return '';
    if (typeof value !== 'string' || !/^\d{1,10}$/.test(value) || Number(value) > 1_000_000_000)
        throw new Error(`${label}は0〜10億円の整数で入力してください。`);
    return value;
}
function calculateSalesUnitPrice(purchaseAmount, shippingFee, margin) {
    if (!purchaseAmount)
        return '';
    const purchase = Number(purchaseAmount), shipping = shippingFee === '' ? 0 : Number(shippingFee), multiplier = Number(margin);
    if (!/^\d{1,10}$/.test(purchaseAmount) || purchase > 1_000_000_000)
        return '';
    if (shippingFee !== '' && (!/^\d{1,10}$/.test(shippingFee) || shipping > 1_000_000_000))
        return '';
    if (!/^\d+(\.\d{1,3})?$/.test(margin) || multiplier <= 0 || multiplier > 100)
        return '';
    return String(Math.round(((purchase + shipping) * multiplier) / 100) * 100);
}
function parseQuoteSettings(value) {
    const d = record(value);
    const partnerId = text(d.partnerId, 'freee取引先ID', 16);
    // freee receives this as a numeric ID. Preserve a user-entered leading-zero form
    // in the draft, while accepting it when its numeric value is a positive safe integer.
    if (!/^\d+$/.test(partnerId) || !Number.isSafeInteger(Number(partnerId)) || Number(partnerId) <= 0)
        throw new Error('freee取引先IDは正の整数を入力してください。');
    const quotationDate = date(d.quotationDate, '見積日'), expirationDate = date(d.expirationDate, '有効期限', true);
    if (expirationDate && expirationDate < quotationDate)
        throw new Error('有効期限は見積日以降にしてください。');
    if (!Array.isArray(d.prices) || !d.prices.length || d.prices.length > 100)
        throw new Error('明細は1〜100行で指定してください。');
    const prices = d.prices.map(value => {
        const p = record(value);
        const purchaseAmount = optionalMoney(p.purchaseAmount, '購入金額');
        const shippingFee = optionalMoney(p.shippingFee, '送料');
        const margin = p.margin === undefined ? '1.2' : text(p.margin, 'マージン', 8);
        if (!/^\d+(\.\d{1,3})?$/.test(margin) || Number(margin) <= 0 || Number(margin) > 100)
            throw new Error('マージンは0より大きく100以下、小数3桁以内で入力してください。');
        const unitPrice = text(p.unitPrice, '販売単価', 14);
        if (!/^\d{1,10}(\.\d{1,3})?$/.test(unitPrice) || Number(unitPrice) > 1_000_000_000)
            throw new Error('販売単価は0〜10億円、小数3桁以内で入力してください。');
        if (purchaseAmount && calculateSalesUnitPrice(purchaseAmount, shippingFee, margin) !== unitPrice)
            throw new Error('販売単価は（購入金額＋送料）×マージンを100円単位に丸めた金額と一致させてください。');
        const taxRate = choice(p.taxRate, [0, 8, 10], '税率');
        if (typeof p.reducedTaxRate !== 'boolean' || (p.reducedTaxRate && taxRate !== 8))
            throw new Error('軽減税率は8%のみ指定できます。');
        return { rfqItemId: text(p.rfqItemId, '品目ID', 128), purchaseAmount, shippingFee, margin, unitPrice, taxRate, reducedTaxRate: p.reducedTaxRate };
    });
    if (new Set(prices.map(p => p.rfqItemId)).size !== prices.length)
        throw new Error('明細が重複しています。');
    if (typeof d.translationsReviewed !== 'boolean')
        throw new Error('翻訳確認の指定が不正です。');
    return {
        partnerId, quotationDate, expirationDate, prices, translationsReviewed: d.translationsReviewed,
        subject: text(d.subject, '件名', 255), quotationNumber: text(d.quotationNumber, '見積書番号', 255, false),
        partnerTitle: choice(d.partnerTitle, ['御中', '様', '(空白)'], '敬称'),
        taxEntryMethod: choice(d.taxEntryMethod, ['in', 'out'], '税区分'),
        taxFraction: choice(d.taxFraction, ['omit', 'round', 'round_up'], '消費税端数処理'),
        lineAmountFraction: choice(d.lineAmountFraction, ['omit', 'round', 'round_up'], '明細端数処理'),
        note: text(d.note, '備考', 4000, false),
    };
}
function millis(value) {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
function divide(amount, divisor, method) {
    return (amount + (method === 'round_up' ? divisor - 1n : method === 'round' ? divisor / 2n : 0n)) / divisor;
}
function hasUnsupportedFreeeDescription(value) {
    return /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value);
}
function freeeDescription(manufacturerName, partNumber, outputDescription) {
    // Keep source text intact; only the external display description is single-line.
    return [manufacturerName.trim(), partNumber.trim(), outputDescription].filter(Boolean).join(' ')
        .replace(/\r\n|[\r\n\t\p{Zl}\p{Zp}]/gu, ' ');
}
function buildQuotePreview(settings, source) {
    if (!source.length || source.length > 100 || source.length !== settings.prices.length || new Set(source.map(s => s.rfqItemId)).size !== source.length)
        throw new Error('確定明細と販売単価の行数が一致しません。');
    const warnings = [];
    const groups = new Map();
    const lines = [...source].sort((a, b) => a.lineNo - b.lineNo).map(s => {
        const price = settings.prices.find(p => p.rfqItemId === s.rfqItemId);
        if (!price)
            throw new Error('確定明細に対応する販売単価がありません。');
        text(s.outputDescription, `明細${s.lineNo}の確定出力文`, 5000);
        text(s.manufacturerName ?? '', 'メーカー名', 500, false);
        text(s.partNumber, '品番', 200, false);
        text(s.unit, '単位', 255);
        const description = freeeDescription(s.manufacturerName ?? '', s.partNumber, s.outputDescription);
        if (hasUnsupportedFreeeDescription(description))
            throw new Error(`明細${s.lineNo}：摘要に送信できない制御文字があります。品番・確定出力文を確認してください。`);
        if ([...description].length > 255)
            throw new Error(`明細${s.lineNo}：品番・区切りスペースを含めるとfreeeの摘要上限255文字を超えます（${[...description].length}文字）。翻訳明細の新しい版が必要です。`);
        if (!s.translatedDescription.trim() || /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(s.outputDescription))
            warnings.push(`明細${s.lineNo}：登録英訳が未入力、または出力文に日本語が含まれています。`);
        if (!Number.isFinite(s.quantity) || s.quantity <= 0 || s.quantity > 99_999_999.999 || !/^\d+(\.\d{1,3})?$/.test(String(s.quantity)))
            throw new Error(`明細${s.lineNo}：freeeへ送信できる数量は小数3桁以内、99999999.999以下です。`);
        const amount = divide(millis(String(s.quantity)) * millis(price.unitPrice), 1000000n, settings.lineAmountFraction);
        const key = `${price.taxRate}:${price.reducedTaxRate}`;
        const group = groups.get(key) ?? { amount: 0n, rate: price.taxRate };
        group.amount += amount;
        groups.set(key, group);
        return { ...s, ...price, description, amount: Number(amount) };
    });
    if (warnings.length && !settings.translationsReviewed)
        throw new Error(`${warnings.join('\n')} プレビューで確認し、翻訳確認にチェックしてください。`);
    let sum = 0n, tax = 0n;
    for (const group of groups.values()) {
        sum += group.amount;
        tax += divide(group.amount * BigInt(group.rate), BigInt(settings.taxEntryMethod === 'in' ? 100 + group.rate : 100), settings.taxFraction);
    }
    const total = settings.taxEntryMethod === 'in' ? sum : sum + tax;
    if (total > 1000000000000n)
        throw new Error('見積合計は1兆円以下にしてください。');
    return { settings, lines, subtotal: Number(settings.taxEntryMethod === 'in' ? sum - tax : sum), tax: Number(tax), total: Number(total), warnings };
}
function toFreeePayload(preview, companyId, marker) {
    const s = preview.settings;
    return {
        company_id: companyId, partner_id: Number(s.partnerId), quotation_date: s.quotationDate,
        ...(s.expirationDate ? { expiration_date: s.expirationDate } : {}),
        ...(s.quotationNumber ? { quotation_number: s.quotationNumber } : {}),
        subject: s.subject, partner_title: s.partnerTitle, tax_entry_method: s.taxEntryMethod,
        tax_fraction: s.taxFraction, line_amount_fraction: s.lineAmountFraction,
        withholding_tax_entry_method: 'out', quotation_note: s.note, memo: marker,
        lines: preview.lines.map(line => ({ type: 'item', description: line.description, quantity: line.quantity, unit: line.unit, unit_price: line.unitPrice, tax_rate: line.taxRate, reduced_tax_rate: line.reducedTaxRate, withholding: false })),
    };
}
