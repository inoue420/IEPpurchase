import { createHash } from 'node:crypto'
import { record, type FreeeQuotePayload } from './salesQuoteModel'

export interface FreeeResult {
  id: number; number: string; reportUrl: string; total: number | null; tax: number | null
  verification: 'matched' | 'needs_review'
  contentDigest?: string
}
export interface FreeeUpdateTarget {
  id: number; number: string; payload: FreeeQuotePayload; total: number; tax: number
  contentDigest?: string
}
export class FreeeRequestError extends Error {
  constructor(public readonly retryable: boolean, message: string) { super(message) }
}
// Preserve fields from the original template. A newly selected delivery location
// overrides the old value through the saved payload. Keep digest field order for legacy records.
const preservedFields = ['template_id', 'branch_no', 'delivery_deadline', 'delivery_location',
  'partner_address_zipcode', 'partner_address_prefecture_code', 'partner_address_street_name1', 'partner_address_street_name2',
  'partner_contact_department', 'partner_contact_email_cc', 'partner_contact_email_to', 'partner_contact_name',
  'partner_display_name', 'partner_sending_method', 'company_contact_name', 'company_name', 'company_description'] as const
const managedFields = ['company_id', 'partner_id', 'quotation_date', 'expiration_date', 'subject', 'partner_title',
  'tax_entry_method', 'tax_fraction', 'line_amount_fraction', 'withholding_tax_entry_method', 'quotation_note', 'memo'] as const
function contentDigest(q: Record<string, unknown>): string {
  const content = [...managedFields, ...preservedFields, 'quotation_number'].map(key => [key, q[key] ?? null])
  const lines = Array.isArray(q.lines) ? q.lines.map(value => {
    const line = record(value)
    return [line.type ?? 'item', line.description, line.quantity, line.unit, Number(line.unit_price), line.tax_rate, line.reduced_tax_rate, line.withholding]
  }) : []
  return createHash('sha256').update(JSON.stringify([content, lines])).digest('hex')
}
export async function readFreeeQuotation(id: number, companyId: number, token: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  try {
    const response = await fetcher(`https://api.freee.co.jp/iv/quotations/${id}?company_id=${companyId}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25_000), redirect: 'error',
    })
    if (!response.ok) throw new Error('lookup failed')
    return await response.json()
  } catch { throw new FreeeRequestError(true, 'freeeの既存見積書を取得できません。接続・権限・見積書IDを確認してください。更新は行っていません。') }
}
async function rejectionDetails(response: Response, token: string): Promise<string> {
  try {
    const raw = await response.text()
    if (raw.length > 32_768) return ''
    const body = record(JSON.parse(raw))
    if (!Array.isArray(body.errors)) return ''
    const messages: string[] = []
    for (const value of body.errors.slice(0, 10)) {
      if (!value || typeof value !== 'object' || !Array.isArray(value.messages)) continue
      for (const message of value.messages.slice(0, 5)) {
        if (typeof message !== 'string') continue
        // Only documented messages; no raw response or headers.
        const safe = (token ? message.split(token).join('[非表示]') : message)
          .replace(/Bearer\s+\S+/gi, 'Bearer [非表示]')
          .replace(/\p{Cc}/gu, ' ').trim().slice(0, 300)
        if (safe && !messages.includes(safe)) messages.push(safe)
        if (messages.length === 5) break
      }
      if (messages.length === 5) break
    }
    return messages.length ? ' freeeの詳細：' + messages.join(' ／ ') : ''
  } catch { return '' }
}

export function freeeResult(value: unknown, payload: FreeeQuotePayload, expectedTotal: number, expectedTax: number): FreeeResult {
  const q = record(record(value).quotation)
  if (!Number.isSafeInteger(q.id) || Number(q.id) <= 0 || q.company_id !== payload.company_id) throw new Error('freeeの作成結果を特定できません。')
  let reportUrl = ''
  if (typeof q.report_url === 'string') {
    try { const url = new URL(q.report_url); if (url.protocol === 'https:' && (url.hostname === 'freee.co.jp' || url.hostname.endsWith('.freee.co.jp')) && !url.username && !url.password) reportUrl = url.toString() } catch { /* Do not expose an untrusted link. */ }
  }
  const lines = Array.isArray(q.lines) ? q.lines : []
  const matched = q.partner_id === payload.partner_id && q.total_amount === expectedTotal && q.amount_tax === expectedTax
    && (payload.delivery_location === undefined || q.delivery_location === payload.delivery_location)
    && lines.length === payload.lines.length && lines.every((value, i) => {
      const line = record(value), expected = payload.lines[i]
      return line.description === expected.description && line.quantity === expected.quantity && line.unit === expected.unit
        && Number(line.unit_price) === Number(expected.unit_price) && line.tax_rate === expected.tax_rate
        && line.reduced_tax_rate === expected.reduced_tax_rate && line.withholding === false
    })
  return { id: Number(q.id), number: typeof q.quotation_number === 'string' ? q.quotation_number : '', reportUrl,
    total: typeof q.total_amount === 'number' ? q.total_amount : null, tax: typeof q.amount_tax === 'number' ? q.amount_tax : null,
    verification: matched ? 'matched' : 'needs_review', contentDigest: contentDigest(q) }
}
export async function createFreeeQuotation(payload: FreeeQuotePayload, token: string, total: number, tax: number, fetcher: typeof fetch = fetch): Promise<FreeeResult> {
  return writeFreeeQuotation(payload, token, total, tax, undefined, fetcher)
}
export async function updateFreeeQuotation(target: FreeeUpdateTarget, payload: FreeeQuotePayload, token: string, total: number, tax: number, fetcher: typeof fetch = fetch): Promise<FreeeResult> {
  const body = await readFreeeQuotation(target.id, payload.company_id, token, fetcher)
  let q: Record<string, unknown>
  try {
    q = record(record(body).quotation)
    const previous = freeeResult(body, target.payload, target.total, target.tax)
    const sameHeader = managedFields.every(key => (q[key] ?? '') === (target.payload[key] ?? ''))
    if (previous.id !== target.id || previous.number !== target.number || previous.verification !== 'matched' || !sameHeader
      || (target.contentDigest && previous.contentDigest !== target.contentDigest)) throw new Error('changed')
  } catch { throw new FreeeRequestError(true, 'freee側の見積内容が前回の転記内容と異なります。手修正した内容を保護するため、上書き更新を停止しました。') }
  if (q.cancel_status !== 'uncanceled' || q.sending_status !== 'unsent') throw new FreeeRequestError(true, 'freeeで送付済み・取消済み、または送付状態を確認できないため上書きできません。顧客へ提示済みの場合は、改訂見積を新規作成してください。')
  const preserved: Record<string, string | number> = {}
  for (const key of preservedFields) {
    const value = q[key]
    if ((typeof value === 'string' && value !== '') || typeof value === 'number') preserved[key] = value
  }
  return writeFreeeQuotation({ ...preserved, ...payload }, token, total, tax, target.id, fetcher)
}
async function writeFreeeQuotation(payload: FreeeQuotePayload, token: string, total: number, tax: number, quotationId: number | undefined, fetcher: typeof fetch): Promise<FreeeResult> {
  const updating = quotationId !== undefined
  let response: Response
  try {
    response = await fetcher(`https://api.freee.co.jp/iv/quotations${updating ? '/' + quotationId : ''}`, {
      method: updating ? 'PUT' : 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(25_000),
    })
  } catch { throw new FreeeRequestError(false, '通信が中断されました。freeeで転記結果を確認し、見積書IDを照合してください。再転記は停止しています。') }
  if (!response.ok) {
    const retryable = [400, 401, 403, 404, 422, 429].includes(response.status)
    const details = retryable ? await rejectionDetails(response, token) : ''
    const guidance = response.status === 401 ? '「freee連携」で再認可してください。'
      : response.status === 403 ? `freeeアプリの見積書${updating ? '更新' : '作成'}権限を確認してください。`
      : '入力内容とfreee側の設定を確認してください。'
    throw new FreeeRequestError(retryable, retryable
      ? `freeeが登録を拒否しました（HTTP ${response.status}）。${guidance}${details}`
      : `freeeの登録結果が不明です（HTTP ${response.status}）。freeeで作成結果を確認してください。再作成は停止しています。`)
  }
  try {
    const result = freeeResult(await response.json(), payload, total, tax)
    if (updating && result.id !== quotationId) throw new Error('unexpected id')
    return result
  }
  catch { throw new FreeeRequestError(false, 'freeeの応答を確認できません。作成済みの可能性があるため、見積書IDを照合してください。') }
}
