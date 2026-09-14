// Pure model shared by the browser preview and the server. Money is JPY.
export type Fraction = 'omit' | 'round' | 'round_up'
export interface QuotePrice { rfqItemId: string; unitPrice: string; taxRate: 0 | 8 | 10; reducedTaxRate: boolean }
export interface QuoteSettings {
  partnerId: string; quotationDate: string; expirationDate: string; subject: string
  quotationNumber: string; partnerTitle: '御中' | '様' | '(空白)'
  taxEntryMethod: 'in' | 'out'; taxFraction: Fraction; lineAmountFraction: Fraction
  note: string; translationsReviewed: boolean; prices: QuotePrice[]
}
export interface ConfirmedLine {
  rfqItemId: string; lineNo: number; partNumber: string; quantity: number; unit: string
  originalDescription: string; translatedDescription: string; outputDescription: string
}
export interface PricedLine extends ConfirmedLine, QuotePrice { description: string; amount: number }
export interface QuotePreview {
  settings: QuoteSettings; lines: PricedLine[]; subtotal: number; tax: number; total: number; warnings: string[]
}
export interface FreeeQuotePayload {
  company_id: number; partner_id: number; quotation_date: string; expiration_date?: string
  quotation_number?: string; subject: string; partner_title: string
  tax_entry_method: 'in' | 'out'; tax_fraction: Fraction; line_amount_fraction: Fraction
  withholding_tax_entry_method: 'out'; quotation_note: string; memo: string
  lines: { type: 'item'; description: string; quantity: number; unit: string; unit_price: string; tax_rate: number; reduced_tax_rate: boolean; withholding: false }[]
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('入力形式が不正です。')
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || (required && !value.trim()) || [...value].length > max) throw new Error(`${label}は${required ? '1〜' : ''}${max}文字以内で入力してください。`)
  return value
}
function date(value: unknown, label: string, optional = false): string {
  if (optional && value === '') return ''
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`${label}を正しく入力してください。`)
  return value
}
function choice<T extends string | number>(value: unknown, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) throw new Error(`${label}が不正です。`)
  return value as T
}
export function parseQuoteSettings(value: unknown): QuoteSettings {
  const d = record(value)
  const partnerId = text(d.partnerId, 'freee取引先ID', 16)
  // freee receives this as a numeric ID. Preserve a user-entered leading-zero form
  // in the draft, while accepting it when its numeric value is a positive safe integer.
  if (!/^\d+$/.test(partnerId) || !Number.isSafeInteger(Number(partnerId)) || Number(partnerId) <= 0) throw new Error('freee取引先IDは正の整数を入力してください。')
  const quotationDate = date(d.quotationDate, '見積日'), expirationDate = date(d.expirationDate, '有効期限', true)
  if (expirationDate && expirationDate < quotationDate) throw new Error('有効期限は見積日以降にしてください。')
  if (!Array.isArray(d.prices) || !d.prices.length || d.prices.length > 100) throw new Error('明細は1〜100行で指定してください。')
  const prices = d.prices.map(value => {
    const p = record(value)
    const unitPrice = text(p.unitPrice, '販売単価', 14)
    if (!/^\d{1,10}(\.\d{1,3})?$/.test(unitPrice) || Number(unitPrice) > 1_000_000_000) throw new Error('販売単価は0〜10億円、小数3桁以内で入力してください。')
    const taxRate = choice(p.taxRate, [0, 8, 10] as const, '税率')
    if (typeof p.reducedTaxRate !== 'boolean' || (p.reducedTaxRate && taxRate !== 8)) throw new Error('軽減税率は8%のみ指定できます。')
    return { rfqItemId: text(p.rfqItemId, '品目ID', 128), unitPrice, taxRate, reducedTaxRate: p.reducedTaxRate }
  })
  if (new Set(prices.map(p => p.rfqItemId)).size !== prices.length) throw new Error('明細が重複しています。')
  if (typeof d.translationsReviewed !== 'boolean') throw new Error('翻訳確認の指定が不正です。')
  return {
    partnerId, quotationDate, expirationDate, prices, translationsReviewed: d.translationsReviewed,
    subject: text(d.subject, '件名', 255), quotationNumber: text(d.quotationNumber, '見積書番号', 255, false),
    partnerTitle: choice(d.partnerTitle, ['御中', '様', '(空白)'] as const, '敬称'),
    taxEntryMethod: choice(d.taxEntryMethod, ['in', 'out'] as const, '税区分'),
    taxFraction: choice(d.taxFraction, ['omit', 'round', 'round_up'] as const, '消費税端数処理'),
    lineAmountFraction: choice(d.lineAmountFraction, ['omit', 'round', 'round_up'] as const, '明細端数処理'),
    note: text(d.note, '備考', 4000, false),
  }
}
function millis(value: string): bigint {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
}
function divide(amount: bigint, divisor: bigint, method: Fraction): bigint {
  return (amount + (method === 'round_up' ? divisor - 1n : method === 'round' ? divisor / 2n : 0n)) / divisor
}
export function hasUnsupportedFreeeDescription(value: string): boolean {
  return /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)
}
export function freeeDescription(partNumber: string, outputDescription: string): string {
  // Keep source text intact; only the external display description is single-line.
  return (partNumber ? partNumber + ' ' + outputDescription : outputDescription)
    .replace(/\r\n|[\r\n\t\p{Zl}\p{Zp}]/gu, ' ')
}
export function buildQuotePreview(settings: QuoteSettings, source: ConfirmedLine[]): QuotePreview {
  if (!source.length || source.length > 100 || source.length !== settings.prices.length || new Set(source.map(s => s.rfqItemId)).size !== source.length) throw new Error('確定明細と販売単価の行数が一致しません。')
  const warnings: string[] = []
  const groups = new Map<string, { amount: bigint; rate: number }>()
  const lines = [...source].sort((a, b) => a.lineNo - b.lineNo).map(s => {
    const price = settings.prices.find(p => p.rfqItemId === s.rfqItemId)
    if (!price) throw new Error('確定明細に対応する販売単価がありません。')
    text(s.outputDescription, `明細${s.lineNo}の確定出力文`, 5000)
    text(s.partNumber, '品番', 200, false); text(s.unit, '単位', 255)
    const description = freeeDescription(s.partNumber, s.outputDescription)
    if (hasUnsupportedFreeeDescription(description)) throw new Error(`明細${s.lineNo}：摘要に送信できない制御文字があります。品番・確定出力文を確認してください。`)
    if ([...description].length > 255) throw new Error(`明細${s.lineNo}：品番・区切りスペースを含めるとfreeeの摘要上限255文字を超えます（${[...description].length}文字）。翻訳明細の新しい版が必要です。`)
    if (!s.translatedDescription.trim() || /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(s.outputDescription)) warnings.push(`明細${s.lineNo}：登録英訳が未入力、または出力文に日本語が含まれています。`)
    if (!Number.isFinite(s.quantity) || s.quantity <= 0 || s.quantity > 99_999_999.999 || !/^\d+(\.\d{1,3})?$/.test(String(s.quantity))) throw new Error(`明細${s.lineNo}：freeeへ送信できる数量は小数3桁以内、99999999.999以下です。`)
    const amount = divide(millis(String(s.quantity)) * millis(price.unitPrice), 1_000_000n, settings.lineAmountFraction)
    const key = `${price.taxRate}:${price.reducedTaxRate}`
    const group = groups.get(key) ?? { amount: 0n, rate: price.taxRate }
    group.amount += amount; groups.set(key, group)
    return { ...s, ...price, description, amount: Number(amount) }
  })
  if (warnings.length && !settings.translationsReviewed) throw new Error(`${warnings.join('\n')} プレビューで確認し、翻訳確認にチェックしてください。`)
  let sum = 0n, tax = 0n
  for (const group of groups.values()) {
    sum += group.amount
    tax += divide(group.amount * BigInt(group.rate), BigInt(settings.taxEntryMethod === 'in' ? 100 + group.rate : 100), settings.taxFraction)
  }
  const total = settings.taxEntryMethod === 'in' ? sum : sum + tax
  if (total > 1_000_000_000_000n) throw new Error('見積合計は1兆円以下にしてください。')
  return { settings, lines, subtotal: Number(settings.taxEntryMethod === 'in' ? sum - tax : sum), tax: Number(tax), total: Number(total), warnings }
}
export function toFreeePayload(preview: QuotePreview, companyId: number, marker: string): FreeeQuotePayload {
  const s = preview.settings
  return {
    company_id: companyId, partner_id: Number(s.partnerId), quotation_date: s.quotationDate,
    ...(s.expirationDate ? { expiration_date: s.expirationDate } : {}),
    ...(s.quotationNumber ? { quotation_number: s.quotationNumber } : {}),
    subject: s.subject, partner_title: s.partnerTitle, tax_entry_method: s.taxEntryMethod,
    tax_fraction: s.taxFraction, line_amount_fraction: s.lineAmountFraction,
    withholding_tax_entry_method: 'out', quotation_note: s.note, memo: marker,
    lines: preview.lines.map(line => ({ type: 'item', description: line.description, quantity: line.quantity, unit: line.unit, unit_price: line.unitPrice, tax_rate: line.taxRate, reduced_tax_rate: line.reducedTaxRate, withholding: false })),
  }
}
